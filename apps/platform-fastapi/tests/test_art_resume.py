import asyncio
import copy

import pytest

from gamerhub_api import art
from gamerhub_api.art import ArtService
from gamerhub_api.bridge import DomainError
from gamerhub_api.models import GenerateInput, RevisionInput
from gamerhub_api.providers import builtin_image
from test_art_workflow import ArtBridge


async def settle(service):
    await asyncio.gather(*list(service.tasks.values()))


@pytest.mark.asyncio
async def test_resume_after_service_restart_preserves_committed_assets_and_original_prompt(monkeypatch):
    bridge = ArtBridge()
    operations, images = [], []
    original = bridge.call

    async def call(operation, params=None):
        operations.append(operation)
        return await original(operation, params)

    async def image(source, role, style, prompt, description):
        images.append((role, style, prompt))
        if len(images) == 4:
            raise DomainError('ART_PROVIDER_TIMEOUT', 504)
        return builtin_image(role, style)

    bridge.call = call
    monkeypatch.setattr(art, 'prepare_image', image)
    service = ArtService(bridge)
    initial = await service.generate('project', GenerateInput(revision=0, prompt='保留最初描述'))
    await settle(service)
    failed = await service.get('project')
    assert failed['status'] == 'failed' and failed['resumeAvailable']
    assert failed['generation']['completed'] == 3
    assert failed['candidates'] == []  # Partial sets cannot be selected.
    preserved = copy.deepcopy(failed['generation']['candidates'][0]['assets'])
    assert len(bridge.uploads) == 3
    await service.close()

    restarted = ArtService(bridge)
    resumed = await restarted.resume('project', RevisionInput(revision=failed['revision']))
    assert resumed['generationId'] != initial['generationId']
    assert resumed['generation']['id'] == initial['generation']['id']
    await settle(restarted)
    ready = await restarted.get('project')
    assert ready['status'] == 'ready'
    assert ready['generation']['phase'] == 'complete'
    assert ready['generation']['completed'] == 8
    assert ready['candidates'][0]['assets'][:3] == preserved
    assert len(bridge.uploads) == 8 and len(images) == 9
    assert all(image[2] == '保留最初描述' for image in images)
    assert operations.count('art.brief') == 1
    assert not ready['resumeAvailable']


@pytest.mark.asyncio
async def test_resume_can_finish_publication_without_any_new_image_or_brief(monkeypatch):
    bridge = ArtBridge()
    original, failed_once = bridge.call, False

    async def call(operation, params=None):
        nonlocal failed_once
        if operation == 'art.save' and params['document']['status'] == 'ready' and not failed_once:
            failed_once = True
            return {'status': 503, 'body': {'code': 'TEMPORARY_STORE_FAILURE'}}
        return await original(operation, params)

    bridge.call = call
    service = ArtService(bridge)
    await service.generate('project', GenerateInput(revision=0, prompt='暮色'))
    await settle(service)
    failed = await service.get('project')
    assert failed['generation']['completed'] == 8 and failed['resumeAvailable']

    async def forbidden(*args):
        pytest.fail('Committed images must not be generated again')

    monkeypatch.setattr(art, 'prepare_image', forbidden)
    # Publication itself is free and must work after configuration changes.
    monkeypatch.setattr(art, 'available_providers', lambda: [])
    monkeypatch.setattr(art, 'generation_fingerprint', lambda _: 'sha256-' + 'f' * 64)
    await service.resume('project', RevisionInput(revision=failed['revision']))
    await settle(service)
    assert bridge.plan['status'] == 'ready' and len(bridge.uploads) == 8


@pytest.mark.asyncio
async def test_transient_checkpoint_save_failure_retains_uploaded_image(monkeypatch):
    bridge = ArtBridge()
    original, failed_once = bridge.call, False

    async def call(operation, params=None):
        nonlocal failed_once
        if (operation == 'art.save' and not failed_once
                and params['document'].get('generation', {}).get('completed') == 1):
            failed_once = True
            return {'status': 503, 'body': {'code': 'TEMPORARY_STORE_FAILURE'}}
        return await original(operation, params)

    bridge.call = call
    service = ArtService(bridge)
    await service.generate('project', GenerateInput(revision=0, prompt='暮色'))
    await settle(service)
    failed = await service.get('project')
    assert failed['generation']['completed'] == 1 and failed['resumeAvailable']
    assert len(bridge.uploads) == 1
    saved_id = bridge.uploads[0]['id']
    await service.resume('project', RevisionInput(revision=failed['revision']))
    await settle(service)
    assert len(bridge.uploads) == 8
    assert bridge.plan['candidates'][0]['assets'][0]['assetId'] == saved_id


@pytest.mark.asyncio
async def test_cancel_fences_late_provider_result_while_explicit_resume_completes(monkeypatch):
    bridge = ArtBridge()
    blocked, release = asyncio.Event(), asyncio.Event()
    calls = 0

    async def image(source, role, style, prompt, description):
        nonlocal calls
        calls += 1
        if calls == 3:
            blocked.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                # A remote provider can finish even after cancellation locally.
                await release.wait()
        return builtin_image(role, style)

    monkeypatch.setattr(art, 'prepare_image', image)
    service = ArtService(bridge)
    await service.generate('project', GenerateInput(revision=0, prompt='月夜'))
    await asyncio.wait_for(blocked.wait(), timeout=2)
    current = await service.get('project')
    old_task = next(iter(service.tasks.values()))
    cancelled = await service.cancel('project', RevisionInput(revision=current['revision']))
    assert cancelled['generation']['completed'] == 2 and cancelled['resumeAvailable']
    # Let the cancellation reach the in-flight provider before resuming.
    await asyncio.sleep(0)
    await service.resume('project', RevisionInput(revision=cancelled['revision']))
    new_task = next(task for task in service.tasks.values() if task is not old_task)
    await new_task
    ready = copy.deepcopy(bridge.plan)
    release.set()
    await old_task
    assert bridge.plan == ready and ready['status'] == 'ready'
    assert len(bridge.uploads) == 8 and calls == 9


@pytest.mark.asyncio
async def test_stale_revision_and_parallel_resume_cannot_start_duplicate_work(monkeypatch):
    bridge = ArtBridge()
    bridge.brief_delay = 10
    service = ArtService(bridge)
    pending = await service.generate('project', GenerateInput(revision=0, prompt='夜色'))
    cancelled = await service.cancel('project', RevisionInput(revision=pending['revision']))
    await service.close()
    with pytest.raises(DomainError, match='ART_CHANGED'):
        await service.resume('project', RevisionInput(revision=0))
    outcomes = await asyncio.gather(*[
        service.resume('project', RevisionInput(revision=cancelled['revision'])) for _ in range(2)
    ], return_exceptions=True)
    assert sum(isinstance(result, dict) for result in outcomes) == 1
    assert sum(isinstance(result, DomainError) for result in outcomes) == 1
    assert len(service.tasks) == 1
    await service.close()


@pytest.mark.asyncio
async def test_changed_configuration_or_corrupt_progress_never_issues_requests(monkeypatch):
    bridge = ArtBridge()
    bridge.brief_delay = 10
    service = ArtService(bridge)
    pending = await service.generate('project', GenerateInput(revision=0, prompt='夜色'))
    cancelled = await service.cancel('project', RevisionInput(revision=pending['revision']))
    await service.close()
    monkeypatch.setattr(art, 'generation_fingerprint', lambda _: 'sha256-' + 'a' * 64)
    assert (await service.get('project'))['resumeReasonCode'] == 'ART_RESUME_PROVIDER_CHANGED'
    with pytest.raises(DomainError, match='ART_RESUME_PROVIDER_CHANGED'):
        await service.resume('project', RevisionInput(revision=cancelled['revision']))
    bridge.plan['generation']['completed'] = 7
    assert (await service.get('project'))['resumeReasonCode'] == 'ART_RESUME_UNAVAILABLE'
    with pytest.raises(DomainError, match='ART_RESUME_UNAVAILABLE'):
        await service.resume('project', RevisionInput(revision=cancelled['revision']))
    assert bridge.uploads == [] and not service.tasks


@pytest.mark.asyncio
async def test_old_failed_documents_still_load_without_resume():
    bridge = ArtBridge()
    bridge.plan['status'] = 'failed'
    service = ArtService(bridge)
    assert (await service.get('project'))['resumeAvailable'] is False
    with pytest.raises(DomainError, match='ART_RESUME_UNAVAILABLE'):
        await service.resume('project', RevisionInput(revision=0))

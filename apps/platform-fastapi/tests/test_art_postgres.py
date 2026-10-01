"""Opt-in storage acceptance: real model planning, Postgres and MinIO, builtin images.

Run with GAMERHUB_ART_PG_TEST=1. Requires migrated local infrastructure and the
existing scanner/decoder on LOCAL_SUPPORT_PORT. Verification rows and a
secret-free artifact are retained under an isolated owner for inspection.
"""
import asyncio
import base64
import copy
import hashlib
import json
import os
from collections import Counter
from datetime import datetime, timezone
from io import BytesIO
from uuid import uuid4

import httpx
import pytest
from PIL import Image

from gamerhub_api import art
from gamerhub_api.app import create_app
from gamerhub_api.bridge import DomainBridge, ROOT, value


def configure_local_environment(monkeypatch, owner):
    from dotenv import dotenv_values

    # Read values, never execute shell text or print credentials; monkeypatch
    # restores every value even when the live integration check fails.
    for name, setting in dotenv_values(ROOT / '.env.local', interpolate=False).items():
        if setting is not None and name not in os.environ:
            monkeypatch.setenv(name, setting)
    monkeypatch.setenv('GAMERHUB_API_USER_ID', owner)
    monkeypatch.setenv('GAMERHUB_LOCAL_USER_ID', owner)
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER', 'builtin')


def ensure_no_existing_art_work():
    import psycopg

    # Recovery uses the configured database role. Do not let an administrative
    # local role's RLS bypass disturb another user's in-flight generation.
    with psycopg.connect(os.environ['DATABASE_URL'], connect_timeout=5) as connection:
        active = connection.execute(
            "SELECT count(*) FROM project_art_plans WHERE document->>'status'='generating'"
        ).fetchone()[0]
    if active:
        pytest.fail('Live art generation is active; rerun the opt-in check after it finishes.')


def save_verification(report):
    target = ROOT / 'artifacts' / 'art-resume'
    target.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    (target / f"verification-{report['ownerId']}.json").write_text(payload, encoding='utf8')
    (target / 'verification.json').write_text(payload, encoding='utf8')


@pytest.mark.asyncio
@pytest.mark.skipif(os.getenv('GAMERHUB_ART_PG_TEST') != '1', reason='Opt in with GAMERHUB_ART_PG_TEST=1; requires real local model/Postgres/MinIO/support services')
async def test_real_art_restart_resume_preserves_committed_images(monkeypatch):
    owner = str(uuid4())
    configure_local_environment(monkeypatch, owner)
    await asyncio.to_thread(ensure_no_existing_art_work)
    assert os.getenv('MODEL_PROVIDER_ID') not in (None, '', 'local-fixture'), 'A real planner must be configured'

    operations = Counter()
    uploaded_ids = []
    generated_slots = []
    attempted_slots = []
    fourth_started = asyncio.Event()
    release_fourth = asyncio.Event()
    original_prepare = art.prepare_image
    report = {
        'status': 'running', 'ownerId': owner,
        'startedAt': datetime.now(timezone.utc).isoformat(),
        'storage': ['postgresql', 'minio'], 'imageSource': 'builtin',
        'plannerProvider': os.getenv('MODEL_PROVIDER_ID'),
        'plannerModel': os.getenv('MODEL_PROVIDER_MODEL_ID'),
        'retainedForInspection': True,
    }
    save_verification(report)

    class ObservedBridge(DomainBridge):
        async def call(self, operation, params=None, timeout=155):
            operations[operation] += 1
            result = await super().call(operation, params, timeout)
            if operation == 'assets.upload' and result['status'] < 400:
                uploaded_ids.append(result['body']['id'])
            return result

    async def interrupt_fourth(source, role, style, prompt, description):
        assert source == 'builtin', 'The acceptance test must never call a paid image provider'
        slot = (style, role)
        attempted_slots.append(slot)
        if len(attempted_slots) == 4:
            fourth_started.set()
            # Cancellation here models process interruption after three durable
            # commits, before the fourth image has been generated or uploaded.
            await release_fourth.wait()
        raw = await original_prepare(source, role, style, prompt, description)
        generated_slots.append(slot)
        return raw

    monkeypatch.setattr(art, 'prepare_image', interrupt_fourth)
    bridges, services = [], []
    try:
        first = ObservedBridge()
        bridges.append(first)
        await first.start()
        first_app = create_app(bridge=first, bearer_token='art-storage-verification')
        services.append(first_app.state.art)
        headers = {'authorization': 'Bearer art-storage-verification'}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=first_app), base_url='http://art-verification', headers=headers) as client:
            created = await client.post('/v1/projects', json={'name': f'断点恢复存储验收-{owner[:8]}'})
            assert created.status_code == 201, created.text
            project_id = created.json()['id']
            report['projectId'] = project_id
            path = f'/v1/projects/{project_id}/art'
            initial_response = await client.post(path + '/generate', json={
                'revision': 0, 'source': 'builtin',
                'prompt': '森林小猫跑酷，内置素材配色，晨光和月夜两套完整素材，用于真实存储断点恢复验收。',
            })
            assert initial_response.status_code == 202, initial_response.text
            initial = initial_response.json()
            generation_id = initial['generation']['id']
            report.update({'generationId': generation_id, 'firstExecutionId': initial['generationId']})
            await asyncio.wait_for(fourth_started.wait(), timeout=180)
            checkpoint = (await client.get(path)).json()
            assert checkpoint['status'] == 'generating'
            assert checkpoint['generation']['completed'] == 3
            committed = copy.deepcopy(checkpoint['generation']['candidates'][0]['assets'])
            assert len(committed) == len(uploaded_ids) == 3
            first_slots = list(generated_slots)
            report['committedBeforeRestart'] = committed
            report['interruptedRevision'] = checkpoint['revision']
            save_verification(report)
            await first_app.state.art.close()
            persisted = await value(first, 'art.get', {'projectId': project_id})
            assert persisted['status'] == 'generating'
            assert persisted['generation']['completed'] == 3
        await first.close()

        second = ObservedBridge()
        bridges.append(second)
        await second.start()
        second_app = create_app(bridge=second, bearer_token='art-storage-verification')
        services.append(second_app.state.art)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=second_app), base_url='http://art-verification', headers=headers) as client:
            recovered_response = await client.get(path)
            assert recovered_response.status_code == 200
            recovered = recovered_response.json()
            assert recovered['status'] == 'failed'
            assert recovered['errorCode'] == 'ART_GENERATION_INTERRUPTED'
            assert recovered['resumeAvailable'] is True
            assert recovered['generation']['completed'] == 3
            assert recovered['generation']['candidates'][0]['assets'] == committed
            assert recovered['revision'] == checkpoint['revision'] + 1
            resumed_response = await client.post(path + '/resume', json={'revision': recovered['revision']})
            assert resumed_response.status_code == 202, resumed_response.text
            resumed = resumed_response.json()
            assert resumed['generation']['id'] == generation_id
            assert resumed['generationId'] != initial['generationId']
            report.update({'recoveryErrorCode': recovered['errorCode'], 'resumeHttpStatus': resumed_response.status_code,
                           'resumedExecutionId': resumed['generationId']})
            await asyncio.wait_for(asyncio.gather(*list(second_app.state.art.tasks.values())), timeout=120)
            ready = (await client.get(path)).json()
            assert ready['status'] == 'ready', ready.get('errorCode')
            assert ready['generation']['phase'] == 'complete'
            assert ready['generation']['completed'] == ready['generation']['total'] == 8
            assert ready['generation']['id'] == generation_id
            assert ready['candidates'][0]['assets'][:3] == committed
            assert len(ready['candidates']) == 2
            assert operations['art.brief'] == 1
            assert operations['assets.upload'] == len(uploaded_ids) == len(set(uploaded_ids)) == 8
            assert len(generated_slots) == len(set(generated_slots)) == 8
            assert all(attempted_slots.count(slot) == 1 for slot in first_slots)
            stored_assets = (await value(second, 'assets.list', {'projectId': project_id}))['items']
            assert len(stored_assets) == 8
            assert {item['id'] for item in stored_assets} == set(uploaded_ids)

            verified_assets = []
            for candidate in ready['candidates']:
                assert len(candidate['assets']) == 4
                for binding in candidate['assets']:
                    content = await value(second, 'assets.content', {'projectId': project_id, 'assetId': binding['assetId']})
                    raw = base64.b64decode(content['bytes_base64'], validate=True)
                    digest = 'sha256-' + hashlib.sha256(raw).hexdigest()
                    assert content['mime_type'] == 'image/png'
                    assert raw.startswith(b'\x89PNG\r\n\x1a\n')
                    assert digest == binding['contentHash']
                    with Image.open(BytesIO(raw)) as image:
                        image.verify()
                    with Image.open(BytesIO(raw)) as image:
                        width, height = image.size
                    verified_assets.append({'style': candidate['style'], 'role': binding['role'], 'assetId': binding['assetId'],
                                            'contentHash': digest, 'bytes': len(raw), 'width': width, 'height': height})

            selected_response = await client.post(path + '/select', json={'revision': ready['revision'], 'candidateId': ready['candidates'][0]['id']})
            assert selected_response.status_code == 200, selected_response.text
            selected = selected_response.json()
            assert selected['status'] == 'ready'
            assert selected['selectedCandidateId'] == ready['candidates'][0]['id']
            report.update({'status': 'passed', 'verifiedAssets': verified_assets,
                           'selectedCandidateId': selected['selectedCandidateId'], 'finalRevision': selected['revision'],
                           'artBriefCalls': operations['art.brief'], 'uploadCalls': operations['assets.upload'],
                           'generatedImages': len(generated_slots), 'preservedImages': len(committed),
                           'generationAttempts': len(attempted_slots), 'externalImageCalls': 0,
                           'finishedAt': datetime.now(timezone.utc).isoformat()})
    finally:
        # Close only processes owned by this test; never restart shared services.
        for service in reversed(services):
            await service.close()
        for bridge in reversed(bridges):
            await bridge.close()
        if report['status'] != 'passed':
            report['status'] = 'failed'
        save_verification(report)

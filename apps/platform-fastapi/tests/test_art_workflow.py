import asyncio
import copy
import hashlib
import base64
from uuid import uuid4

import pytest
from PIL import Image
from io import BytesIO

from gamerhub_api.art import ArtService
from gamerhub_api.bridge import DomainError
from gamerhub_api.models import GenerateInput, RevisionInput, SelectInput
from gamerhub_api.providers import builtin_image
from gamerhub_api import art


class ArtBridge:
    def __init__(self):
        self.plan = {'revision': 0, 'status': 'empty', 'prompt': '', 'requirements': [], 'candidates': []}
        self.uploads = []
        self.selections = 0
        self.brief_delay = 0

    async def call(self, operation, params=None):
        params = params or {}
        if operation == 'art.get':
            body = copy.deepcopy(self.plan)
        elif operation == 'art.save':
            if params['revision'] != self.plan['revision']:
                return {'status': 409, 'body': {'code': 'ART_CHANGED'}}
            self.plan = {**copy.deepcopy(params['document']), 'revision': self.plan['revision'] + 1}
            self.selections += int(params.get('select', False))
            body = self.plan
        elif operation == 'art.brief':
            await asyncio.sleep(self.brief_delay)
            body = {'requirements': [{'role': role, 'description': role} for role in ('cat', 'forest', 'coin', 'stump')], 'styles': ['night', 'dusk']}
        elif operation == 'assets.upload':
            raw = base64.b64decode(params['body']['bytes_base64'])
            body = {'id': str(uuid4()), 'name': params['body']['name'], 'contentHash': 'sha256-' + hashlib.sha256(raw).hexdigest()}
            self.uploads.append(body)
        else:
            raise AssertionError(operation)
        return {'status': 200, 'body': copy.deepcopy(body)}


@pytest.mark.asyncio
async def test_no_upload_required_complete_candidates_selection_and_stale_revision():
    bridge = ArtBridge()
    service = ArtService(bridge)
    pending = await service.generate('project', GenerateInput(revision=0, prompt='月夜和暮色'))
    assert pending['status'] == 'generating'
    await asyncio.gather(*list(service.tasks.values()))
    ready = await service.get('project')
    assert ready['status'] == 'ready'
    assert len(ready['candidates']) == 2
    assert len(bridge.uploads) == 8
    assert all(len(item['assets']) == 4 for item in ready['candidates'])
    assert all(item['provenance']['provider'] == 'builtin' for item in ready['candidates'])
    assert all(item['provenance']['createdAt'] for item in ready['candidates'])
    with pytest.raises(DomainError, match='ART_CHANGED'):
        await service.select('project', SelectInput(revision=0, candidateId=ready['candidates'][0]['id']))
    selected = await service.select('project', SelectInput(revision=ready['revision'], candidateId=ready['candidates'][0]['id']))
    assert selected['selectedCandidateId'] == ready['candidates'][0]['id']
    assert bridge.selections == 1


@pytest.mark.asyncio
async def test_cancel_prevents_late_generation_overwriting_state():
    bridge = ArtBridge()
    bridge.brief_delay = 10
    service = ArtService(bridge)
    pending = await service.generate('project', GenerateInput(revision=0, prompt='月夜'))
    await service.cancel('project', RevisionInput(revision=pending['revision']))
    await service.close()
    assert bridge.plan['errorCode'] == 'ART_GENERATION_CANCELLED'
    assert bridge.uploads == []


@pytest.mark.asyncio
async def test_missing_provider_is_honest_and_does_not_replace_source(monkeypatch):
    monkeypatch.delenv('GAMERHUB_IMAGE_PROVIDER_URL', raising=False)
    bridge = ArtBridge()
    service = ArtService(bridge)
    with pytest.raises(DomainError, match='ART_PROVIDER_UNAVAILABLE'):
        await service.generate('project', GenerateInput(revision=0, prompt='夜色', source='image-provider'))
    assert bridge.plan['revision'] == 0
    assert bridge.uploads == []


def test_builtin_sets_are_visibly_different_and_keep_sprite_alpha():
    day, night = builtin_image('forest', 'day'), builtin_image('forest', 'night')
    assert day != night
    with Image.open(BytesIO(builtin_image('cat', 'night'))) as image:
        assert image.size == (256, 256)
        assert image.getchannel('A').getextrema() == (0, 255)


@pytest.mark.asyncio
@pytest.mark.parametrize('invalid', [
    None,
    {'styles': ['day']},
    {'styles': ['day', 'day']},
    {'styles': ['day', 'dusk', 'night']},
    {'styles': ['day', []]},
    {'styles': ['day', 'night'], 'requirements': []},
    {'styles': ['day', 'night'], 'requirements': [{'role': 'cat', 'description': 'cat'}] * 4},
    {'styles': ['day', 'night'], 'requirements': [{'role': role, 'description': ' '} for role in ('cat', 'forest', 'coin', 'stump')]},
])
async def test_invalid_model_brief_cannot_trigger_billable_images(monkeypatch, invalid):
    bridge = ArtBridge()
    original = bridge.call
    async def call(operation, params=None):
        if operation == 'art.brief':
            return {'status': 200, 'body': invalid}
        return await original(operation, params)
    bridge.call = call
    generated = []
    async def image(*args):
        generated.append(args)
        raise AssertionError('No image request is allowed for an invalid plan')
    monkeypatch.setattr(art, 'prepare_image', image)
    monkeypatch.setattr(art, 'available_providers', lambda: [{'id': 'image-provider', 'available': True}])
    service = ArtService(bridge)
    await service.generate('project', GenerateInput(revision=0, prompt='月夜', source='image-provider'))
    await asyncio.gather(*list(service.tasks.values()))
    assert bridge.plan['status'] == 'failed'
    assert bridge.plan['errorCode'] == 'ART_PLANNER_INVALID'
    assert not generated and not bridge.uploads


@pytest.mark.asyncio
async def test_partial_provider_failure_preserves_previous_selection(monkeypatch):
    bridge = ArtBridge()
    old = {'id': 'old', 'name': '旧素材', 'source': 'builtin', 'assets': []}
    bridge.plan.update({'candidates': [old], 'selectedCandidateId': 'old'})
    calls = []
    async def image(source, role, style, prompt, description):
        calls.append(role)
        if len(calls) == 2:
            raise DomainError('ART_PROVIDER_TIMEOUT', 504)
        return builtin_image(role, style)
    monkeypatch.setattr(art, 'prepare_image', image)
    monkeypatch.setattr(art, 'available_providers', lambda: [{'id': 'image-provider', 'available': True, 'provider': 'gateway'}])
    service = ArtService(bridge)
    await service.generate('project', GenerateInput(revision=0, prompt='新素材', source='image-provider'))
    await asyncio.gather(*list(service.tasks.values()))
    assert bridge.plan['errorCode'] == 'ART_PROVIDER_TIMEOUT'
    assert bridge.plan['candidates'] == [old]
    assert bridge.plan['selectedCandidateId'] == 'old'
    assert len(calls) == 2

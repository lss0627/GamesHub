import asyncio
import base64
import copy
import re
from datetime import datetime, timezone
from uuid import uuid4

from .bridge import DomainError, value
from .providers import ROLES, ROLE_NAMES, STYLE_NAMES, available_providers, generation_fingerprint, prepare_image


def validate_art_brief(brief):
    """Bound the model's asset plan before any potentially billable request."""
    if not isinstance(brief, dict):
        raise DomainError('ART_PLANNER_INVALID', 502)
    styles, requirements = brief.get('styles'), brief.get('requirements')
    if (not isinstance(styles, list) or len(styles) != 2
            or any(not isinstance(style, str) or style not in STYLE_NAMES for style in styles)
            or len(set(styles)) != 2
            or not isinstance(requirements, list) or len(requirements) != len(ROLES)):
        raise DomainError('ART_PLANNER_INVALID', 502)
    descriptions = {}
    for item in requirements:
        if (not isinstance(item, dict) or not isinstance(item.get('role'), str)
                or item['role'] not in ROLES or item['role'] in descriptions
                or not isinstance(item.get('description'), str)
                or not 1 <= len(item['description'].strip()) <= 2000):
            raise DomainError('ART_PLANNER_INVALID', 502)
        descriptions[item['role']] = item['description'].strip()
    return styles, descriptions


def validate_generation(generation):
    """Reject malformed persisted progress before skipping or issuing requests."""
    if (not isinstance(generation, dict) or generation.get('source') not in ('builtin', 'image-provider')
            or generation.get('phase') not in ('planning', 'images', 'complete')
            or generation.get('total') != 8 or type(generation.get('completed')) is not int
            or not 0 <= generation['completed'] <= 8
            or not isinstance(generation.get('fingerprint'), str)
            or not re.fullmatch(r'sha256-[a-f0-9]{64}', generation['fingerprint'])):
        raise DomainError('ART_RESUME_UNAVAILABLE', 409)
    try:
        from uuid import UUID
        UUID(generation['id'])
        if generation['phase'] == 'planning':
            if generation['completed'] or any(generation.get(key) != [] for key in ('styles', 'requirements', 'candidates')):
                raise ValueError('planning')
            return
        styles, _ = validate_art_brief(generation)
        candidates = generation['candidates']
        if not isinstance(candidates, list) or len(candidates) != 2:
            raise ValueError('candidates')
        seen_assets, seen_candidates, completed = set(), set(), 0
        for style, candidate in zip(styles, candidates):
            UUID(candidate['id'])
            if candidate['id'] in seen_candidates or candidate['style'] != style or candidate['source'] != generation['source']:
                raise ValueError('candidate')
            seen_candidates.add(candidate['id'])
            if not isinstance(candidate['assets'], list) or len(candidate['assets']) > 4:
                raise ValueError('assets')
            roles = set()
            for asset in candidate['assets']:
                UUID(asset['assetId'])
                if (asset['role'] not in ROLES or asset['role'] in roles or asset['assetId'] in seen_assets
                        or not re.fullmatch(r'sha256-[a-f0-9]{64}', asset['contentHash'])):
                    raise ValueError('binding')
                roles.add(asset['role'])
                seen_assets.add(asset['assetId'])
                completed += 1
        if completed != generation['completed'] or (generation['phase'] == 'complete' and completed != 8):
            raise ValueError('progress')
    except (DomainError, ValueError, KeyError, TypeError, AttributeError):
        raise DomainError('ART_RESUME_UNAVAILABLE', 409) from None


class ArtService:
    def __init__(self, bridge):
        self.bridge = bridge
        self.tasks = {}

    async def get(self, project_id):
        plan = await value(self.bridge, 'art.get', {'projectId': project_id})
        return self._view(plan)

    def _resume_reason(self, plan):
        if plan.get('status') != 'failed' or not plan.get('generation'):
            return 'ART_RESUME_UNAVAILABLE'
        generation = plan['generation']
        try:
            validate_generation(generation)
        except DomainError:
            return 'ART_RESUME_UNAVAILABLE'
        if generation['phase'] == 'complete':
            return 'ART_RESUME_UNAVAILABLE'
        # An interrupted publication needs no provider or new paid requests.
        if generation['completed'] == generation['total']:
            return None
        provider = next((item for item in available_providers() if item['id'] == generation['source']), None)
        if not provider or not provider['available']:
            return 'ART_PROVIDER_UNAVAILABLE'
        if generation_fingerprint(generation['source']) != generation['fingerprint']:
            return 'ART_RESUME_PROVIDER_CHANGED'
        return None

    def _view(self, plan):
        reason = self._resume_reason(plan)
        return {**plan, 'providers': available_providers(), 'resumeAvailable': reason is None,
                **({'resumeReasonCode': reason} if plan.get('status') == 'failed' else {})}

    async def save(self, project_id, plan, revision, select=False):
        document = {key: val for key, val in plan.items() if key not in ('providers', 'applied', 'resumeAvailable', 'resumeReasonCode')}
        saved = await value(self.bridge, 'art.save', {'projectId': project_id, 'revision': revision, 'document': document, 'select': select})
        return self._view(saved)

    def _start(self, project_id, generation_id):
        task = asyncio.create_task(self._prepare(project_id, generation_id))
        self.tasks[generation_id] = task
        task.add_done_callback(lambda _: self.tasks.pop(generation_id, None))

    async def generate(self, project_id, request):
        plan = await self.get(project_id)
        if plan['revision'] != request.revision:
            raise DomainError('ART_CHANGED', 409)
        if plan['status'] == 'generating':
            raise DomainError('ART_GENERATING', 409)
        provider = next(item for item in available_providers() if item['id'] == request.source)
        if not provider['available']:
            raise DomainError('ART_PROVIDER_UNAVAILABLE', 503)
        generation_id = str(uuid4())
        generation = {'id': generation_id, 'source': request.source, 'provider': provider.get('provider', request.source),
                      'fingerprint': generation_fingerprint(request.source), 'phase': 'planning', 'total': 8, 'completed': 0,
                      'requirements': [], 'styles': [], 'candidates': []}
        if provider.get('model'):
            generation['model'] = provider['model']
        pending = {**plan, 'status': 'generating', 'prompt': request.prompt, 'generationId': generation_id,
                   'startedAt': datetime.now(timezone.utc).isoformat(), 'generation': generation}
        pending.pop('errorCode', None)
        saved = await self.save(project_id, pending, request.revision)
        self._start(project_id, generation_id)
        return saved

    async def resume(self, project_id, request):
        plan = await self.get(project_id)
        if plan['revision'] != request.revision:
            raise DomainError('ART_CHANGED', 409)
        if reason := self._resume_reason(plan):
            raise DomainError(reason, 503 if reason == 'ART_PROVIDER_UNAVAILABLE' else 409)
        # New execution token fences late results from an interrupted attempt.
        generation_id = str(uuid4())
        pending = {**plan, 'status': 'generating', 'generationId': generation_id,
                   'startedAt': datetime.now(timezone.utc).isoformat(), 'generation': copy.deepcopy(plan['generation'])}
        pending.pop('errorCode', None)
        pending['generation'].pop('active', None)
        saved = await self.save(project_id, pending, request.revision)
        self._start(project_id, generation_id)
        return saved

    async def _owned(self, project_id, generation_id):
        plan = await self.get(project_id)
        return plan if plan.get('generationId') == generation_id and plan['status'] == 'generating' else None

    async def _checkpoint(self, project_id, generation_id, generation):
        current = await self._owned(project_id, generation_id)
        if current is None:
            return None
        return await self.save(project_id, {**current, 'generation': generation}, current['revision'])

    async def _prepare(self, project_id, generation_id):
        generation = None
        try:
            plan = await self._owned(project_id, generation_id)
            if plan is None:
                return
            generation = copy.deepcopy(plan['generation'])
            validate_generation(generation)
            source = generation['source']
            if generation['phase'] == 'planning':
                brief = await value(self.bridge, 'art.brief', {'projectId': project_id, 'prompt': plan['prompt']})
                styles, _ = validate_art_brief(brief)
                provenance = {'provider': generation['provider'], 'createdAt': datetime.now(timezone.utc).isoformat()}
                if generation.get('model'):
                    provenance['model'] = generation['model']
                generation.update({'phase': 'images', 'requirements': brief['requirements'], 'styles': styles,
                                   'candidates': [{'id': str(uuid4()), 'name': STYLE_NAMES[style], 'source': source,
                                                   'style': style, 'assets': [], 'provenance': provenance} for style in styles]})
                if await self._checkpoint(project_id, generation_id, generation) is None:
                    return
            _, descriptions = validate_art_brief(generation)
            for candidate in generation['candidates']:
                style = candidate['style']
                for role in ROLES:
                    if any(asset['role'] == role for asset in candidate['assets']):
                        continue
                    if generation_fingerprint(source) != generation['fingerprint']:
                        raise DomainError('ART_RESUME_PROVIDER_CHANGED', 409)
                    generation['active'] = {'style': style, 'role': role}
                    if await self._checkpoint(project_id, generation_id, generation) is None:
                        return
                    raw = await prepare_image(source, role, style, plan['prompt'], descriptions[role])
                    if await self._owned(project_id, generation_id) is None:
                        return
                    uploaded = await value(self.bridge, 'assets.upload', {'projectId': project_id, 'body': {
                        'name': f'{STYLE_NAMES[style]}-{ROLE_NAMES[role]}.png', 'mime_type': 'image/png',
                        'bytes_base64': base64.b64encode(raw).decode(),
                        'license_text': 'GamerHub 项目内置原创素材配色' if source == 'builtin' else '用户配置的图片生成服务，按该服务条款使用',
                    }})
                    candidate['assets'].append({'role': role, 'assetId': uploaded['id'], 'contentHash': uploaded['contentHash'], 'name': uploaded['name']})
                    generation['completed'] += 1
                    generation.pop('active', None)
                    if await self._checkpoint(project_id, generation_id, generation) is None:
                        return
            current = await self._owned(project_id, generation_id)
            if current is None:
                return
            # Keep the selected set and recent alternatives, without unbounded document growth.
            selected = [item for item in current['candidates'] if item['id'] == current.get('selectedCandidateId')]
            others = [item for item in current['candidates'] if item['id'] != current.get('selectedCandidateId')][-6:]
            generation['phase'] = 'complete'
            await self.save(project_id, {**current, 'status': 'ready', 'generation': generation,
                                        'requirements': generation['requirements'],
                                        'candidates': selected + others + generation['candidates']}, current['revision'])
        except asyncio.CancelledError:
            raise
        except Exception as error:
            try:
                current = await self.get(project_id)
                if current.get('generationId') == generation_id and current['status'] == 'generating':
                    code = error.code if isinstance(error, DomainError) else 'ART_GENERATION_FAILED'
                    # If upload succeeded but its checkpoint save failed, retain
                    # that result while recording failure. This retries storage
                    # only, never a potentially billable image request.
                    persisted = current.get('generation', {})
                    if (generation and generation.get('id') == persisted.get('id')
                            and generation['completed'] > persisted.get('completed', 0)):
                        current['generation'] = generation
                    await self.save(project_id, {**current, 'status': 'failed', 'errorCode': code}, current['revision'])
            except Exception:
                # Persisted generating state is recovered on the next runtime start.
                pass

    async def select(self, project_id, request):
        plan = await self.get(project_id)
        if plan['revision'] != request.revision:
            raise DomainError('ART_CHANGED', 409)
        if plan['status'] == 'generating':
            raise DomainError('ART_GENERATING', 409)
        candidate = next((item for item in plan['candidates'] if item['id'] == request.candidateId), None)
        if not candidate:
            raise DomainError('ART_SELECTION_INVALID', 400)
        return await self.save(project_id, {**plan, 'status': 'ready', 'selectedCandidateId': candidate['id']}, plan['revision'], select=True)

    async def cancel(self, project_id, request):
        plan = await self.get(project_id)
        if plan['revision'] != request.revision:
            raise DomainError('ART_CHANGED', 409)
        if plan['status'] != 'generating':
            raise DomainError('ART_NOT_GENERATING', 409)
        saved = await self.save(project_id, {**plan, 'status': 'failed', 'errorCode': 'ART_GENERATION_CANCELLED'}, plan['revision'])
        if task := self.tasks.get(plan.get('generationId')):
            task.cancel()
        return saved

    async def close(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

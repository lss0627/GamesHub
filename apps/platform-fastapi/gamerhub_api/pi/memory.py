"""Explicit, sourced memory. Model suggestions never become user decisions automatically."""
import re
from datetime import datetime, timezone
from uuid import uuid4

from .repository import AgentStateError


def select_memories(document, query='', limit=24):
    words = set(re.findall(r'[a-z0-9]+|[\u4e00-\u9fff]{2}', query.lower()))
    active = [item for item in document.get('items', []) if item.get('status') == 'active' and item.get('source') == 'user']
    def rank(item):
        tokens = set(re.findall(r'[a-z0-9]+|[\u4e00-\u9fff]{2}', item['content'].lower()))
        return (item['kind'] == 'constraint', len(tokens & words), item.get('updatedAt', ''), item['id'])
    # Constraints are mandatory; only optional preferences are relevance-selected.
    constraints = sorted((i for i in active if i['kind'] == 'constraint'), key=rank, reverse=True)
    optional = sorted((i for i in active if i['kind'] != 'constraint'), key=rank, reverse=True)
    return constraints + optional[:max(0, limit - len(constraints))]


class MemoryService:
    def __init__(self, repository):
        self.repository = repository

    @staticmethod
    def visible(document):
        return {**document, 'items': [{**i, 'createdAt': i.get('createdAt')} for i in document['items'] if i['status'] == 'active']}

    async def get(self, project_id):
        return self.visible(await self.repository.get_memory(project_id))

    async def change(self, project_id, change):
        if not isinstance(change, dict) or set(change) - {'revision', 'operation', 'id', 'kind', 'content'}:
            raise AgentStateError('MEMORY_INPUT_INVALID')
        revision = change.get('revision')
        if type(revision) is not int or revision < 0 or change.get('operation') not in ('upsert', 'delete'):
            raise AgentStateError('MEMORY_INPUT_INVALID')
        document = await self.repository.get_memory(project_id)
        if revision != document['revision']:
            raise AgentStateError('MEMORY_CHANGED', 409)
        items = document['items']
        item = next((i for i in items if i['id'] == change.get('id')), None)
        if change.get('id') and (not item or item['status'] != 'active'):
            raise AgentStateError('MEMORY_NOT_FOUND', 404)
        if change['operation'] == 'delete':
            if not item:
                raise AgentStateError('MEMORY_NOT_FOUND', 404)
            item.update(content='', status='deleted', revision=item['revision'] + 1)
        else:
            content = change.get('content')
            if change.get('kind') not in ('preference', 'constraint', 'decision') or not isinstance(content, str) or not 1 <= len(content.strip()) <= 1200:
                raise AgentStateError('MEMORY_INPUT_INVALID')
            if not item:
                if sum(i['status'] == 'active' for i in items) >= 200:
                    raise AgentStateError('MEMORY_LIMIT', 409)
                # Keep a bounded graveyard; removed IDs still cannot be upserted.
                if len(items) >= 400:
                    deleted = next(i for i in items if i['status'] == 'deleted')
                    items.remove(deleted)
                item = {'id': str(uuid4()), 'source': 'user', 'revision': 0, 'createdAt': datetime.now(timezone.utc).isoformat()}
                items.append(item)
            item.update(kind=change['kind'], content=content.strip(), status='active', revision=item['revision'] + 1)
        item['updatedAt'] = datetime.now(timezone.utc).isoformat()
        return self.visible(await self.repository.save_memory(project_id, revision, items))

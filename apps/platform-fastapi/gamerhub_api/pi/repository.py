"""Single Python-owned durable state; every query is scoped to the local owner."""
import asyncio
import hashlib
import json
import os
from contextlib import asynccontextmanager
from uuid import UUID

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from .client import PiError


class AgentStateError(PiError):
    def __init__(self, code, status=400):
        self.code, self.status = code, status
        super().__init__(code)


async def in_thread(function, *args):
    """Settle the DB operation before cancellation can release its connection."""
    work = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(work)
    except asyncio.CancelledError:
        await work
        raise


class Cursor:
    def __init__(self, cursor):
        self.cursor = cursor
    async def fetchone(self):
        return await in_thread(self.cursor.fetchone)
    async def fetchall(self):
        return await in_thread(self.cursor.fetchall)


@asynccontextmanager
async def threaded_context(manager):
    entering = asyncio.create_task(asyncio.to_thread(manager.__enter__))
    try:
        value = await asyncio.shield(entering)
    except asyncio.CancelledError as error:
        await entering
        await in_thread(manager.__exit__, type(error), error, error.__traceback__)
        raise
    try:
        yield value
    except BaseException as error:
        await in_thread(manager.__exit__, type(error), error, error.__traceback__)
        raise
    else:
        await in_thread(manager.__exit__, None, None, None)


class Connection:
    def __init__(self, connection):
        self.connection = connection
    async def execute(self, query, parameters=None):
        return Cursor(await in_thread(self.connection.execute, query, parameters))
    def transaction(self):
        return threaded_context(self.connection.transaction())


class DatabasePool:
    """Threaded bounded psycopg pool, compatible with Windows subprocess Proactor loop."""
    def __init__(self, dsn):
        self.pool = ConnectionPool(dsn, min_size=0, max_size=4, open=False,
                                  kwargs={'row_factory': dict_row, 'connect_timeout': 5, 'options': '-c statement_timeout=15000'}, timeout=8)
    async def open(self):
        await in_thread(self.pool.open)
    async def close(self):
        await in_thread(self.pool.close)
    @asynccontextmanager
    async def connection(self):
        async with threaded_context(self.pool.connection()) as conn:
            yield Connection(conn)


class AgentRepository:
    def __init__(self, dsn=None, owner_id=None):
        self.dsn = dsn or os.getenv('DATABASE_URL')
        self.owner_id = owner_id or os.getenv('GAMERHUB_API_USER_ID') or os.getenv('GAMERHUB_LOCAL_USER_ID', '00000000-0000-4000-8000-000000000001')
        self.pool = None
        self.lock = asyncio.Lock()

    async def open(self):
        async with self.lock:
            if self.pool is None:
                if not self.dsn:
                    raise AgentStateError('AGENT_STORE_UNAVAILABLE', 503)
                pool = DatabasePool(self.dsn)
                await pool.open()
                self.pool = pool

    async def close(self):
        if self.pool:
            await self.pool.close()
            self.pool = None

    @asynccontextmanager
    async def transaction(self, project_id, run_id=None, *, lock=False):
        try:
            UUID(project_id)
            if run_id:
                UUID(run_id)
        except (ValueError, TypeError, AttributeError) as error:
            raise AgentStateError('NOT_FOUND', 404) from error
        await self.open()
        async with self.pool.connection() as conn, conn.transaction():
            await conn.execute("SELECT set_config('app.current_user_id', %s, true)", (self.owner_id,))
            cursor = await conn.execute('SELECT id, current_spec_version_id FROM projects WHERE id=%s AND owner_id=%s' + (' FOR UPDATE' if lock else ''), (project_id, self.owner_id))
            project = await cursor.fetchone()
            if not project:
                raise AgentStateError('NOT_FOUND', 404)
            if run_id:
                cursor = await conn.execute('SELECT id FROM runs WHERE id=%s AND project_id=%s', (run_id, project_id))
                if not await cursor.fetchone():
                    raise AgentStateError('NOT_FOUND', 404)
            yield conn, project

    async def get_memory(self, project_id):
        async with self.transaction(project_id) as (conn, _):
            row = await (await conn.execute('SELECT revision, document FROM project_agent_memory WHERE project_id=%s', (project_id,))).fetchone()
            return {'revision': row['revision'], **row['document']} if row else {'revision': 0, 'items': []}

    async def save_memory(self, project_id, revision, items):
        async with self.transaction(project_id, lock=True) as (conn, _):
            row = await (await conn.execute('SELECT revision FROM project_agent_memory WHERE project_id=%s', (project_id,))).fetchone()
            if (row['revision'] if row else 0) != revision:
                raise AgentStateError('MEMORY_CHANGED', 409)
            await conn.execute('''INSERT INTO project_agent_memory(project_id,revision,document) VALUES(%s,%s,%s)
                ON CONFLICT(project_id) DO UPDATE SET revision=EXCLUDED.revision, document=EXCLUDED.document, updated_at=now()''',
                (project_id, revision + 1, Jsonb({'items': items})))
            return {'revision': revision + 1, 'items': items}

    async def knowledge(self, project_id, run_id=None):
        async with self.transaction(project_id, run_id) as (conn, project):
            row = await (await conn.execute('SELECT revision,document FROM project_agent_memory WHERE project_id=%s', (project_id,))).fetchone()
            memory = {'revision': row['revision'], **row['document']} if row else {'revision': 0, 'items': []}
            spec = None
            completed = []
            if run_id:
                spec = await (await conn.execute('SELECT id,spec_json FROM game_spec_versions WHERE project_id=%s AND source_run_id=%s ORDER BY version_number DESC LIMIT 1', (project_id, run_id))).fetchone()
                completed = await (await conn.execute("SELECT payload FROM run_events WHERE run_id=%s AND event_type='task.progress' AND payload->>'status'='completed' ORDER BY sequence DESC LIMIT 30", (run_id,))).fetchall()
            if not spec and project['current_spec_version_id']:
                spec = await (await conn.execute('SELECT id,spec_json FROM game_spec_versions WHERE project_id=%s AND id=%s', (project_id, project['current_spec_version_id']))).fetchone()
            return {'projectId': project_id, 'memory': memory,
                    'confirmedSpec': {'id': str(spec['id']), 'spec': spec['spec_json']} if spec else None,
                    'completedTasks': [r['payload'] for r in reversed(completed)]}

    async def load_checkpoint(self, project_id, run_id):
        async with self.transaction(project_id, run_id) as (conn, _):
            row = await (await conn.execute('SELECT revision,document FROM agent_checkpoints WHERE run_id=%s AND project_id=%s', (run_id, project_id))).fetchone()
            if row:
                return row['document'], row['revision']
            # Read-only compatibility with feature006. New writes never duplicate transcripts in events.
            old = await (await conn.execute("SELECT payload->'checkpoint' AS document FROM run_events WHERE run_id=%s AND event_type='agent.pi.checkpoint' ORDER BY sequence DESC LIMIT 1", (run_id,))).fetchone()
            return (old['document'] if old else None), 0

    async def save_checkpoint(self, project_id, run_id, revision, document):
        raw = json.dumps(document, ensure_ascii=False, sort_keys=True).encode('utf8')
        if len(raw) > 8_000_000:
            raise AgentStateError('CHECKPOINT_SIZE_LIMIT', 413)
        async with self.transaction(project_id, run_id, lock=True) as (conn, _):
            row = await (await conn.execute('SELECT revision FROM agent_checkpoints WHERE run_id=%s AND project_id=%s', (run_id, project_id))).fetchone()
            if (row['revision'] if row else 0) != revision:
                raise AgentStateError('CHECKPOINT_CHANGED', 409)
            await conn.execute('''INSERT INTO agent_checkpoints(run_id,project_id,revision,document,content_hash) VALUES(%s,%s,%s,%s,%s)
                ON CONFLICT(run_id) DO UPDATE SET revision=EXCLUDED.revision,document=EXCLUDED.document,content_hash=EXCLUDED.content_hash,updated_at=now()''',
                (run_id, project_id, revision + 1, Jsonb(document), hashlib.sha256(raw).hexdigest()))
            return revision + 1

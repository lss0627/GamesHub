"""Opt-in real Postgres tests, isolated UUID rows and targeted cleanup only."""
import os
from uuid import uuid4

import pytest

from gamerhub_api.pi.memory import MemoryService
from gamerhub_api.pi.repository import AgentRepository, AgentStateError


@pytest.mark.asyncio
@pytest.mark.skipif(os.getenv('GAMERHUB_AGENT_PG_TEST') != '1', reason='Requires migrated local Postgres')
async def test_real_postgres_restart_cas_owner_and_run_isolation():
    from dotenv import dotenv_values
    dsn = os.getenv('DATABASE_URL') or dotenv_values('.env.local').get('DATABASE_URL')
    owner, project, session, run = [str(uuid4()) for _ in range(4)]
    repo = AgentRepository(dsn, owner_id=owner)
    foreign = AgentRepository(dsn, owner_id=str(uuid4()))
    await repo.open()
    try:
        async with repo.pool.connection() as conn:
            await conn.execute("INSERT INTO users(id,email,display_name,status,role) VALUES(%s,%s,'Agent verification','active','creator')", (owner, f'{owner}@test.invalid'))
            await conn.execute("INSERT INTO projects(id,owner_id,name,slug,workspace_repo_key,quota_profile) VALUES(%s,%s,'Agent verification',%s,%s,'local')", (project, owner, project, project))
            await conn.execute("INSERT INTO agent_sessions(id,project_id,runtime_type,runtime_session_ref,status) VALUES(%s,%s,'pi-agent-core',%s,'active')", (session, project, session))
            await conn.execute("INSERT INTO runs(id,project_id,session_id,request_type,user_input,idempotency_key) VALUES(%s,%s,%s,'validate','Agent verification',%s)", (run, project, session, run))
        memory = await MemoryService(repo).change(project, {'revision': 0, 'operation': 'upsert', 'kind': 'constraint', 'content': '不含血腥，失败可重试'})
        saved_id = memory['items'][0]['id']
        revision = await repo.save_checkpoint(project, run, 0, {'actions': {'first': {'status': 'completed', 'output': {'verified': True}}}})
        assert revision == 1
        with pytest.raises(AgentStateError, match='CHECKPOINT_CHANGED'):
            await repo.save_checkpoint(project, run, 0, {})
        with pytest.raises(AgentStateError, match='NOT_FOUND'):
            await repo.save_checkpoint(project, str(uuid4()), 0, {})
        for read in (foreign.get_memory(project), foreign.load_checkpoint(project, run)):
            with pytest.raises(AgentStateError, match='NOT_FOUND'):
                await read
        await repo.close()
        repo = AgentRepository(dsn, owner_id=owner)
        assert (await MemoryService(repo).get(project))['items'][0]['id'] == saved_id
        state, revision = await repo.load_checkpoint(project, run)
        assert revision == 1 and state['actions']['first']['output']['verified']
        await MemoryService(repo).change(project, {'revision': 1, 'operation': 'delete', 'id': saved_id})
        await repo.close()
        repo = AgentRepository(dsn, owner_id=owner)
        assert (await MemoryService(repo).get(project))['items'] == []
        assert (await repo.get_memory(project))['items'][0]['content'] == ''
    finally:
        await repo.open()
        async with repo.pool.connection() as conn:
            await conn.execute('DELETE FROM agent_checkpoints WHERE run_id=%s AND project_id=%s', (run, project))
            await conn.execute('DELETE FROM project_agent_memory WHERE project_id=%s', (project,))
            await conn.execute('DELETE FROM runs WHERE id=%s AND project_id=%s', (run, project))
            await conn.execute('DELETE FROM agent_sessions WHERE id=%s AND project_id=%s', (session, project))
            await conn.execute('DELETE FROM projects WHERE id=%s AND owner_id=%s', (project, owner))
            await conn.execute('DELETE FROM users WHERE id=%s', (owner,))
        await repo.close()
        await foreign.close()

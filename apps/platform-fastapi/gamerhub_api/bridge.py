import asyncio
import json
import os
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[3]


class DomainError(Exception):
    def __init__(self, code: str, status: int = 500):
        self.code, self.status = code, status
        super().__init__(code)


class DomainBridge:
    """Multiplexed local stdio transport. No Fastify server or HTTP forwarding."""

    def __init__(self):
        self.process = None
        self.pending = {}
        self.ready = asyncio.Event()
        self.domain_ready = False
        self.writer = asyncio.Lock()
        self.reader_task = None
        self.agent_tasks = {}
        from .pi.service import PiService
        self.pi = PiService(self._pi_callback)

    async def _pi_callback(self, request_id, name, body):
        result = await self.call('pi.callback', {'requestId': request_id, 'name': name, 'body': body}, timeout=1900)
        if result['status'] >= 400:
            from .pi.client import PiError
            raise PiError(result.get('body', {}).get('code', 'PI_CALLBACK_FAILED'))
        return result['body']

    async def _agent_request(self, message):
        from .pi.client import PiError
        reply = {'type': 'python_response', 'id': message['id']}
        try:
            reply['result'] = await self.pi.dispatch(message['operation'], message['params'])
        except asyncio.CancelledError:
            reply['error'] = 'PI_CANCELLED'
        except Exception as error:
            reply['error'] = str(error).split('\n')[0][:120] if isinstance(error, PiError) else 'PI_EXECUTION_FAILED'
        finally:
            self.agent_tasks.pop(message['id'], None)
        if self.process and self.process.returncode is None:
            async with self.writer:
                self.process.stdin.write((json.dumps(reply, ensure_ascii=False) + '\n').encode('utf8'))
                await self.process.stdin.drain()

    async def start(self):
        self.pi.runtime_info = await self.pi.client.probe()
        self.process = await asyncio.create_subprocess_exec(
            'node', '--import', 'tsx', 'apps/local-dev/src/rpc-server.ts',
            cwd=ROOT, env=os.environ.copy(), stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=None, limit=16 * 1024 * 1024,
            **({'creationflags': 0x08000000} if os.name == 'nt' else {}),
        )
        self.reader_task = asyncio.create_task(self._read())
        try:
            await asyncio.wait_for(self.ready.wait(), timeout=45)
            if not self.domain_ready or self.process.returncode is not None:
                raise DomainError('DOMAIN_UNAVAILABLE', 503)
        except BaseException:
            await self.close()
            raise

    async def _read(self):
        try:
            while line := await self.process.stdout.readline():
                try:
                    result = json.loads(line)
                except (ValueError, UnicodeError):
                    continue
                if result.get('ready'):
                    self.domain_ready = True
                    self.ready.set()
                    continue
                if result.get('type') == 'python_request':
                    self.agent_tasks[result['id']] = asyncio.create_task(self._agent_request(result))
                    continue
                if result.get('type') == 'python_cancel':
                    task = self.agent_tasks.get(result['id'])
                    if task:
                        task.cancel()
                    continue
                future = self.pending.pop(result.get('id'), None)
                if future is not None and not future.done():
                    future.set_result(result)
        finally:
            self.domain_ready = False
            self.ready.set()
            for task in list(self.agent_tasks.values()):
                task.cancel()
            for future in list(self.pending.values()):
                if not future.done():
                    future.set_exception(DomainError('DOMAIN_UNAVAILABLE', 503))
            self.pending.clear()

    async def call(self, operation: str, params=None, timeout=155):
        if not self.process or self.process.returncode is not None:
            raise DomainError('DOMAIN_UNAVAILABLE', 503)
        request_id = str(uuid4())
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        try:
            payload = json.dumps({'id': request_id, 'operation': operation, 'params': params or {}}, ensure_ascii=False)
            async with self.writer:
                self.process.stdin.write((payload + '\n').encode('utf-8'))
                await self.process.stdin.drain()
            return await asyncio.wait_for(future, timeout=timeout)
        except TimeoutError as error:
            raise DomainError('DOMAIN_TIMEOUT', 504) from error
        finally:
            self.pending.pop(request_id, None)

    async def close(self):
        for task in list(self.agent_tasks.values()):
            task.cancel()
        await asyncio.gather(*list(self.agent_tasks.values()), return_exceptions=True)
        if self.process and self.process.returncode is None:
            self.process.stdin.close()
            try:
                await asyncio.wait_for(self.process.wait(), 10)
            except TimeoutError:
                if os.name == 'nt':
                    killer = await asyncio.create_subprocess_exec('taskkill', '/pid', str(self.process.pid), '/t', '/f', stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, creationflags=0x08000000)
                    await killer.wait()
                else:
                    self.process.kill()
                await self.process.wait()
        if self.reader_task:
            await self.reader_task
        await self.pi.repository.close()


async def value(bridge, operation, params=None):
    result = await bridge.call(operation, params)
    if result['status'] >= 400:
        raise DomainError(result.get('body', {}).get('code', 'INTERNAL_ERROR'), result['status'])
    return result['body']

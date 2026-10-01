import asyncio
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
HIDDEN = {'creationflags': 0x08000000} if os.name == 'nt' else {}


class PiError(Exception):
    pass


async def terminate(process):
    if process.returncode is not None:
        return
    if os.name == 'nt':
        killer = await asyncio.create_subprocess_exec('taskkill', '/pid', str(process.pid), '/t', '/f',
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, **HIDDEN)
        await killer.wait()
    else:
        import signal
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    await process.wait()


class PiClient:
    def __init__(self, command=None):
        self.command = command or ['node', str(ROOT / 'apps/pi-runtime/host.mjs')]

    async def probe(self):
        process = await asyncio.create_subprocess_exec(*self.command, '--probe', cwd=ROOT,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, **HIDDEN)
        try:
            output, _ = await asyncio.wait_for(process.communicate(), 10)
            result = json.loads(output)
            if process.returncode != 0 or result.get('runtime') != 'pi-agent-core' or not result.get('available'):
                raise PiError('PI_NOT_INSTALLED')
            return {'status': 'ready', 'runtime': result['runtime'], 'version': result['version'], 'controller': 'python'}
        except (ValueError, TimeoutError) as error:
            raise PiError('PI_NOT_INSTALLED') from error
        finally:
            if process.returncode is None:
                await terminate(process)

    async def run(self, request, *, tool=None, on_event=None, context=None, timeout=180):
        # No general environment/credential set is shared with the model process.
        names = ('PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'DEEPSEEK_API_KEY')
        env = {key: os.environ[key] for key in names if key in os.environ}
        process = await asyncio.create_subprocess_exec(*self.command, cwd=ROOT, env=env,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            limit=16 * 1024 * 1024, **HIDDEN, **({'start_new_session': True} if os.name != 'nt' else {}))
        async def drain_errors():
            # Drain boundedly without surfacing provider messages containing secrets.
            while await process.stderr.read(4096):
                pass
        errors = asyncio.create_task(drain_errors())
        async def send(message):
            process.stdin.write((json.dumps(message, ensure_ascii=False) + '\n').encode('utf8'))
            await process.stdin.drain()
        try:
            async with asyncio.timeout(timeout):
                await send({'type': 'start', **request})
                while line := await process.stdout.readline():
                    try:
                        event = json.loads(line)
                    except (ValueError, UnicodeError) as error:
                        raise PiError('PI_PROTOCOL_INVALID') from error
                    kind = event.get('type')
                    if kind == 'tool_request':
                        try:
                            if tool is None:
                                raise PiError('TOOL_NOT_ALLOWED')
                            result = await tool(event['name'], event['args'], event['id'])
                            await send({'type': 'tool_result', 'id': event['id'], 'result': result})
                        except Exception as error:
                            code = str(error) if isinstance(error, PiError) else 'TOOL_EXECUTION_FAILED'
                            await send({'type': 'tool_result', 'id': event['id'], 'error': code[:8000],
                                        'errorDetails': {'code': code.split('\n')[0][:120], 'retryable': getattr(error, 'retryable', False)}})
                    elif kind == 'context_request':
                        try:
                            if context is None:
                                raise PiError('PI_CONTEXT_UNAVAILABLE')
                            messages = await context(event['messages'])
                            await send({'type': 'context_result', 'id': event['id'], 'result': messages})
                        except Exception as error:
                            code = str(error).split('\n')[0] if isinstance(error, PiError) else 'PI_CONTEXT_UNAVAILABLE'
                            await send({'type': 'context_result', 'id': event['id'], 'error': code[:120]})
                    elif kind == 'event':
                        if on_event:
                            await on_event(event['event'])
                        if event.get('id'):
                            await send({'type': 'ack', 'id': event['id']})
                    elif kind == 'completed':
                        return event
                    elif kind == 'failed':
                        raise PiError(event.get('code', 'PI_FAILED'))
                    elif kind != 'ready':
                        raise PiError('PI_PROTOCOL_INVALID')
                raise PiError('PI_PROCESS_EXITED')
        except TimeoutError as error:
            raise PiError('PI_TIMEOUT') from error
        finally:
            if process.returncode is None:
                try:
                    await send({'type': 'abort'})
                    await asyncio.wait_for(process.wait(), 1)
                except (Exception, asyncio.CancelledError):
                    await terminate(process)
            await errors

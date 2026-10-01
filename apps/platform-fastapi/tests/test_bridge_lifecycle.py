import asyncio

import pytest

from gamerhub_api.bridge import DomainBridge, DomainError


@pytest.mark.asyncio
async def test_eof_before_ready_never_starts_http_service(monkeypatch):
    """EOF can arrive before subprocess.returncode is populated on Windows."""
    bridge = DomainBridge()
    class Process:
        returncode = None
        stdout = asyncio.StreamReader()
    process = Process()
    process.stdout.feed_eof()
    async def create(*args, **kwargs):
        return process
    async def probe():
        return {'status': 'ready'}
    closed = []
    async def close():
        closed.append(True)
    monkeypatch.setattr(asyncio, 'create_subprocess_exec', create)
    monkeypatch.setattr(bridge.pi.client, 'probe', probe)
    monkeypatch.setattr(bridge, 'close', close)
    with pytest.raises(DomainError, match='DOMAIN_UNAVAILABLE'):
        await bridge.start()
    assert closed and not bridge.domain_ready

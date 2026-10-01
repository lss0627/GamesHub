import asyncio
import os

import uvicorn
from dotenv import load_dotenv

from .app import create_app
from .bridge import DomainBridge, ROOT


async def main():
    load_dotenv(ROOT / '.env.local', override=False)
    bridge = DomainBridge()
    await bridge.start()
    app = create_app(bridge=bridge)
    # One owned domain/Worker process shared by both HTTP ports. No reload duplication.
    ports = (int(os.getenv('API_PORT', '3001')), int(os.getenv('LOCAL_SUPPORT_PORT', '3010')))
    servers = [uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, lifespan='off', log_level='warning')) for port in ports]
    tasks = [asyncio.create_task(server.serve()) for server in servers]
    try:
        print(f'GamerHub FastAPI: API {ports[0]}, preview {ports[1]}, domain/Unity stdio', flush=True)
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for server in servers:
            server.should_exit = True
        await asyncio.gather(*tasks, return_exceptions=True)
        await app.state.art.close()
        await bridge.close()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

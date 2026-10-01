import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { expect, test } from '@playwright/test';

type RpcResult = { status: number; body: Record<string, unknown> };
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('RPC_TEST_TIMEOUT')), 30000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('missing Unity keeps project access available and blocks admission without creating a run', async () => {
  test.skip(
    process.env.GAMERHUB_REAL_FLOW !== '1',
    'Real database explicitly enabled',
  );
  test.setTimeout(120000);
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/local-dev/src/rpc-server.ts'],
    {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test', UNITY_EDITOR_PATH: '' },
    },
  );
  const lines = createInterface({ input: child.stdout });
  const responses = new Map<string, (value: RpcResult) => void>();
  let counter = 0;
  let onReady: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    onReady = resolve;
  });
  lines.on('line', (line) => {
    const value = JSON.parse(line);
    if (value.ready) onReady?.();
    if (value.id) {
      responses.get(value.id)?.(value);
      responses.delete(value.id);
    }
  });
  child.stderr.on('data', () => undefined);
  const call = (operation: string, params: Record<string, unknown> = {}) =>
    bounded(
      new Promise<RpcResult>((resolve) => {
        const id = String(++counter);
        responses.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ id, operation, params })}\n`);
      }),
    );
  try {
    await bounded(ready);
    expect((await call('health')).body).toMatchObject({
      status: 'blocked',
      creationReady: false,
      services: {
        unity: {
          code: 'UNITY_EDITOR_NOT_FOUND',
          license: 'checked-during-build',
        },
      },
    });
    const projects = await call('projects.list');
    expect(projects.status).toBe(200);
    const projectId =
      process.env.GAMERHUB_FLOW_PROJECT_ID ??
      (projects.body.items as Array<{ id: string }>)[0]?.id;
    expect(projectId).toBeTruthy();
    expect((await call('design.get', { projectId })).status).toBe(200);
    const before = await call('runs.list', { projectId });
    const published = (
      before.body.items as Array<{
        status: string;
        result_summary?: string;
      }>
    ).find(
      (run) =>
        run.status === 'succeeded' && run.result_summary?.startsWith('http'),
    );
    expect(
      published,
      'Use an existing project with a real published preview',
    ).toBeTruthy();
    const buildHash = new URL(String(published?.result_summary)).pathname.split(
      '/',
    )[3];
    expect(
      await call('preview.resolve', { projectId, buildHash }),
    ).toMatchObject({
      status: 200,
      body: { projectId, buildHash },
    });
    expect(
      await call('runs.create', {
        projectId,
        headers: { 'idempotency-key': 'readiness-test' },
        body: { prompt: 'runner', request_type: 'create' },
      }),
    ).toMatchObject({ status: 503, body: { code: 'UNITY_NOT_READY' } });
    expect((await call('runs.list', { projectId })).body.items).toHaveLength(
      (before.body.items as unknown[]).length,
    );
  } finally {
    child.stdin.end();
    child.kill();
    lines.close();
  }
});

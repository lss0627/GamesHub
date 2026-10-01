import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, sep } from 'node:path';
import { type Browser, chromium, type Page } from '@playwright/test';
import sharp from 'sharp';

/** A temporary loopback server exposes only the artifact being inspected. */
export async function serveBrowserArtifact(directory: string) {
  const root = await realpath(directory);
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405).end();
        return;
      }
      const requested = decodeURIComponent(
        new URL(request.url ?? '/', 'http://localhost').pathname,
      );
      if (/[\\:\0]/.test(requested)) throw new Error('PATH');
      const parts = requested.split('/').filter(Boolean);
      if (parts.some((part) => part === '.' || part === '..'))
        throw new Error('PATH');
      if (requested.endsWith('/')) parts.push('index.html');
      let path = root;
      for (const part of parts) {
        path = join(path, part);
        if ((await lstat(path)).isSymbolicLink()) throw new Error('PATH');
      }
      const resolved = await realpath(path);
      if (!resolved.startsWith(root + sep) || !(await lstat(resolved)).isFile())
        throw new Error('PATH');
      const compression = resolved.endsWith('.br')
        ? 'br'
        : resolved.endsWith('.gz')
          ? 'gzip'
          : undefined;
      const extension = extname(compression ? resolved.slice(0, -3) : resolved);
      const mime: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.wasm': 'application/wasm',
        '.data': 'application/octet-stream',
        '.png': 'image/png',
        '.css': 'text/css',
        '.json': 'application/json',
      };
      response.setHeader(
        'Content-Type',
        mime[extension] ?? 'application/octet-stream',
      );
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      if (compression) response.setHeader('Content-Encoding', compression);
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      const stream = createReadStream(resolved);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('BROWSER_SERVER_FAILED');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
    },
  };
}

export interface BrowserBuildInput {
  root: string;
  evidenceDirectory: string;
  buildHash: string;
  runId: string;
  specVersionId: string;
  runtime: string;
  genre: string;
  autoIncome?: number;
  loadTimeoutMs?: number;
  actionTimeoutMs?: number;
  creative?: {
    contentHash: string;
    nodes: number;
    clips: number;
    sounds: number;
  };
}
export interface BrowserBuildResult {
  passed: boolean;
  code?: string;
  reportHash: string;
  runId: string;
  specVersionId: string;
  buildHash: string;
  checks: Array<{
    id: string;
    status: 'passed' | 'failed';
    durationMs: number;
  }>;
}
type State = Record<string, unknown>;
const failure = (code: string) => Object.assign(new Error(code), { code });
const number = (state: State, name: string) => {
  const value = state[name];
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw failure('BROWSER_TELEMETRY_INVALID');
  return value;
};
const readState = (page: Page): Promise<State | undefined> =>
  page.evaluate(
    () =>
      (window as unknown as { __gamerhubGameState?: State })
        .__gamerhubGameState,
  );

export async function inspectBrowserBuild(
  input: BrowserBuildInput,
): Promise<BrowserBuildResult> {
  await mkdir(input.evidenceDirectory, { recursive: true });
  let server: Awaited<ReturnType<typeof serveBrowserArtifact>> | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  const checks: BrowserBuildResult['checks'] = [];
  const diagnostics: string[] = [];
  const observations: Array<{ check: string; state: State | undefined }> = [];
  let code: string | undefined;
  const actionTimeout = input.actionTimeoutMs ?? 5000;
  const check = async (id: string, action: () => Promise<void>) => {
    const start = Date.now();
    try {
      await action();
      checks.push({ id, status: 'passed', durationMs: Date.now() - start });
    } catch (error) {
      checks.push({ id, status: 'failed', durationMs: Date.now() - start });
      throw error;
    }
    if (page) observations.push({ check: id, state: await readState(page) });
  };
  try {
    server = await serveBrowserArtifact(input.root);
    try {
      browser = await chromium.launch({ headless: true, timeout: 20000 });
    } catch {
      throw failure('BROWSER_UNAVAILABLE');
    }
    const context = await browser.newContext({
      viewport: { width: 960, height: 600 },
      serviceWorkers: 'block',
    });
    const origin = server.origin;
    await context.routeWebSocket('**/*', (socket) => {
      if (diagnostics.length < 30)
        diagnostics.push('WebSocket request blocked');
      socket.close();
    });
    await context.route('**/*', async (route) => {
      if (
        new URL(route.request().url()).origin === origin &&
        ['GET', 'HEAD'].includes(route.request().method())
      )
        await route.continue();
      else {
        if (diagnostics.length < 30)
          diagnostics.push('External or mutating request blocked');
        await route.abort();
      }
    });
    page = await context.newPage();
    const game = page;
    game.setDefaultTimeout(actionTimeout);
    game.on('pageerror', (error) => {
      if (diagnostics.length < 30)
        diagnostics.push(error.message.slice(0, 1000));
    });
    game.on('console', (message) => {
      if (message.type() === 'error' && diagnostics.length < 30)
        diagnostics.push(message.text().slice(0, 1000));
    });
    const state = async () => {
      const value = await readState(game);
      if (!value || typeof value !== 'object')
        throw failure('BROWSER_TELEMETRY_MISSING');
      if (
        value.runtime !== input.runtime ||
        value.genre !== input.genre ||
        value.specVersionId !== input.specVersionId
      )
        throw failure('BROWSER_IDENTITY_MISMATCH');
      return value;
    };
    const poll = async (
      predicate: (value: State) => boolean,
      timeout = actionTimeout,
    ) => {
      const deadline = Date.now() + timeout;
      do {
        const value = await state();
        if (predicate(value)) return value;
        await game.waitForTimeout(40);
      } while (Date.now() < deadline);
      throw failure('BROWSER_INTERACTION_FAILED');
    };
    const click = async (x: number, y: number) => {
      const box = await game.locator('canvas').first().boundingBox();
      if (!box || box.width < 100 || box.height < 100)
        throw failure('BROWSER_CANVAS_MISSING');
      await game.mouse.click(
        box.x + (x / 960) * box.width,
        box.y + (y / 600) * box.height,
      );
    };
    const key = async (name: string, ms = 80) => {
      await game.keyboard.down(name);
      try {
        await game.waitForTimeout(ms);
      } finally {
        await game.keyboard.up(name);
      }
    };
    await check('load-and-identity', async () => {
      await game.goto(origin, {
        waitUntil: 'domcontentloaded',
        timeout: input.loadTimeoutMs ?? 150000,
      });
      try {
        await game.waitForFunction(
          () =>
            Boolean(
              (window as unknown as { __gamerhubGameState?: unknown })
                .__gamerhubGameState,
            ),
          undefined,
          { timeout: input.loadTimeoutMs ?? 150000 },
        );
      } catch {
        throw failure('BROWSER_TELEMETRY_MISSING');
      }
      if ((await state()).phase !== 'ready')
        throw failure('BROWSER_INITIAL_STATE_INVALID');
    });
    await check('visible-canvas', async () => {
      const canvas = game.locator('canvas').first();
      if (!(await canvas.isVisible())) throw failure('BROWSER_CANVAS_MISSING');
      const png = await canvas.screenshot({
        path: join(input.evidenceDirectory, 'ready.png'),
      });
      const stats = await sharp(png).stats();
      if (stats.channels.slice(0, 3).every((channel) => channel.stdev < 2))
        throw failure('BROWSER_CANVAS_EMPTY');
    });
    const creativeState = () =>
      game.evaluate(
        () =>
          (window as unknown as { __gamerhubCreativeState?: State })
            .__gamerhubCreativeState,
      );
    if (input.creative)
      await check('creative-document', async () => {
        try {
          await game.waitForFunction(
            () =>
              Boolean(
                (window as unknown as { __gamerhubCreativeState?: unknown })
                  .__gamerhubCreativeState,
              ),
            undefined,
            { timeout: actionTimeout },
          );
        } catch {
          throw failure('BROWSER_CREATIVE_MISSING');
        }
        const value = await creativeState();
        if (
          !value ||
          value.contentHash !== input.creative?.contentHash ||
          value.nodes !== input.creative?.nodes ||
          value.clips !== input.creative?.clips ||
          value.sounds !== input.creative?.sounds
        )
          throw failure('BROWSER_CREATIVE_MISMATCH');
        await writeFile(
          join(input.evidenceDirectory, 'creative-ready.json'),
          JSON.stringify(value, null, 2),
        );
      });
    await check('start', async () => {
      await click(
        480,
        input.genre === 'runner'
          ? 386
          : input.runtime === 'arena-v1'
            ? 393
            : input.genre === 'clicker'
              ? 482
              : 420,
      );
      await poll((value) => value.phase === 'playing');
    });
    if (input.creative)
      await check('creative-start', async () => {
        await game.waitForFunction(
          () =>
            (window as unknown as { __gamerhubCreativeState?: State })
              .__gamerhubCreativeState?.phase === 'playing',
          undefined,
          { timeout: actionTimeout },
        );
        const value = await creativeState();
        if (!value || number(value, 'events') < 1)
          throw failure('BROWSER_CREATIVE_START_FAILED');
      });
    const pause = async () =>
      input.genre === 'clicker' ? click(850, 538) : key('p');
    await check('pause-and-resume', async () => {
      await pause();
      const paused = await poll((value) => value.phase === 'paused');
      // Compare successive source objects without assigning anything to the game.
      // An elapsed timer frozen by a hung game alone is not proof of pause.
      const samples = await game.evaluate(async () => {
        let previous = (window as unknown as { __gamerhubGameState?: State })
          .__gamerhubGameState;
        const samples: State[] = [];
        for (let i = 0; i < 15; i++) {
          await new Promise((done) => setTimeout(done, 80));
          const next = (window as unknown as { __gamerhubGameState?: State })
            .__gamerhubGameState;
          if (next && next !== previous) samples.push(next);
          previous = next;
        }
        return samples;
      });
      if (
        samples.length < 3 ||
        samples.some(
          (value) =>
            value.phase !== 'paused' ||
            number(value, 'elapsed') !== number(paused, 'elapsed'),
        )
      )
        throw failure('BROWSER_PAUSE_FAILED');
      if (input.creative) {
        const first = await creativeState();
        await game.waitForTimeout(220);
        const second = await creativeState();
        if (
          !first ||
          !second ||
          first.phase !== 'paused' ||
          second.phase !== 'paused' ||
          first.time !== second.time
        )
          throw failure('BROWSER_CREATIVE_PAUSE_FAILED');
      }
      await pause();
      await poll((value) => value.phase === 'playing');
    });
    await check('core-interaction', async () => {
      const before = await state();
      if (input.genre === 'runner' || input.genre === 'platformer') {
        await key('d', 150);
        await poll((value) => number(value, 'x') > number(before, 'x'));
        await game.keyboard.down('Space');
        try {
          await poll((value) => number(value, 'y') > number(before, 'y') + 0.1);
        } finally {
          await game.keyboard.up('Space');
        }
      } else if (input.runtime === 'arena-v1') {
        await key('d', 180);
        await poll((value) => number(value, 'x') > number(before, 'x'));
        if (input.genre === 'top_down_shooter') {
          const box = await game.locator('canvas').first().boundingBox();
          if (!box) throw failure('BROWSER_CANVAS_MISSING');
          await game.mouse.move(
            box.x + box.width * 0.85,
            box.y + box.height / 2,
          );
          await game.keyboard.down('Space');
          try {
            await poll(
              (value) => number(value, 'attacks') > number(before, 'attacks'),
            );
          } finally {
            await game.keyboard.up('Space');
          }
        } else
          await poll(
            (value) => number(value, 'attacks') > number(before, 'attacks'),
            20000,
          );
      } else if (input.genre === 'clicker') {
        await click(500, 407);
        await poll(
          (value) =>
            number(value, 'total') - number(before, 'total') >
            (input.autoIncome ?? 0) *
              (number(value, 'elapsed') - number(before, 'elapsed')) +
              0.1,
        );
      } else if (input.genre === 'flappy') {
        await game.keyboard.down('Space');
        try {
          await poll((value) => number(value, 'y') > number(before, 'y') + 0.1);
        } finally {
          await game.keyboard.up('Space');
        }
      } else if (input.genre === 'breakout') {
        await key('d', 150);
        const moved = await poll(
          (value) => number(value, 'x') > number(before, 'x'),
        );
        await key('Space');
        await poll((value) => number(value, 'y') > number(moved, 'y') + 0.1);
      } else if (input.genre === 'tower_defense') {
        await click(160, 338);
        await poll(
          (value) => number(value, 'currency') < number(before, 'currency'),
        );
      } else if (input.genre === 'puzzle') {
        if (typeof before.board !== 'string' || !before.board)
          throw failure('BROWSER_TELEMETRY_INVALID');
        await key('ArrowLeft');
        await poll(
          (value) =>
            number(value, 'score') > number(before, 'score') &&
            value.board !== before.board,
        );
        await key('z');
        await poll(
          (value) =>
            value.board === before.board && value.score === before.score,
        );
      } else if (input.genre === 'rpg_dialogue') {
        for (const [y, node] of [
          [360, 1],
          [360, 0],
          [425, 2],
          [360, 3],
        ] as const) {
          await click(500, y);
          await poll((value) => value.node === node);
        }
        const final = await state();
        if (final.hasKey !== true || final.phase !== 'won')
          throw failure('BROWSER_INTERACTION_FAILED');
      } else throw failure('BROWSER_PROFILE_UNSUPPORTED');
      const final = await state();
      if (final.phase !== 'playing' && final.phase !== 'won')
        throw failure('BROWSER_UNEXPECTED_TERMINAL');
    });
    await check('runtime-errors', async () => {
      if (diagnostics.length) throw failure('BROWSER_RUNTIME_ERROR');
    });
    await game.screenshot({
      path: join(input.evidenceDirectory, 'playing.png'),
    });
  } catch (error) {
    const candidate = (error as { code?: string }).code;
    code =
      candidate && /^BROWSER_[A-Z_]+$/.test(candidate)
        ? candidate
        : 'BROWSER_INSPECTION_FAILED';
    if (diagnostics.length < 30) diagnostics.push(String(error).slice(0, 2000));
    if (page) {
      observations.push({
        check: 'failure',
        state: await readState(page).catch(() => undefined),
      });
      await page
        .screenshot({
          path: join(input.evidenceDirectory, 'failed.png'),
          timeout: 3000,
        })
        .catch(() => undefined);
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  }
  const result = {
    passed: !code,
    ...(code ? { code } : {}),
    runId: input.runId,
    specVersionId: input.specVersionId,
    buildHash: input.buildHash,
    checks,
  };
  const report = JSON.stringify(
    {
      ...result,
      version: 1,
      genre: input.genre,
      runtime: input.runtime,
      verifiedAt: new Date().toISOString(),
      observations,
      diagnostics,
    },
    null,
    2,
  );
  await writeFile(
    join(input.evidenceDirectory, 'browser.json'),
    report,
    'utf8',
  );
  return {
    ...result,
    reportHash: `sha256-${createHash('sha256').update(report).digest('hex')}`,
  };
}

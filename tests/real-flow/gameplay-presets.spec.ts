import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { gameCapabilities } from '../../packages/game-spec/src';

type State = {
  runtime: string;
  genre: string;
  phase: string;
  specVersionId: string;
  elapsed: number;
  x: number;
  y: number;
  score: number;
  total: number;
  health: number;
  currency: number;
  wave: number;
  node: number;
  hasKey: boolean;
  attacks: number;
  damage: number;
  wallet: number;
};
const directory = 'artifacts/gameplay-extensibility';
let server: Server;
let base: string;
const profiles = gameCapabilities.filter((p) => p.runtime);
test.beforeAll(async () => {
  test.skip(
    process.env.GAMERHUB_REAL_FLOW !== '1',
    'Requires actual WebGL acceptance builds',
  );
  const root = resolve(
    'unity/Acceptance/GameplayExtensibility/Builds/Web/Presets',
  );
  await mkdir(directory, { recursive: true });
  server = createServer(async (req, res) => {
    try {
      const requested = decodeURIComponent(
        new URL(req.url ?? '/', 'http://localhost').pathname,
      );
      const path = resolve(
        root,
        `.${requested.endsWith('/') ? `${requested}index.html` : requested}`,
      );
      if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) {
        res.writeHead(404).end();
        return;
      }
      const compression = path.endsWith('.br')
        ? 'br'
        : path.endsWith('.gz')
          ? 'gzip'
          : undefined;
      const extension = extname(compression ? path.slice(0, -3) : path);
      const mime: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.wasm': 'application/wasm',
        '.data': 'application/octet-stream',
        '.png': 'image/png',
        '.css': 'text/css',
      };
      res.setHeader(
        'Content-Type',
        mime[extension] ?? 'application/octet-stream',
      );
      if (compression) res.setHeader('Content-Encoding', compression);
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      createReadStream(path).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('SERVER_REQUIRED');
  base = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
});
const state = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __gamerhubGameState: State }).__gamerhubGameState,
  );
async function key(page: Page, name: string, ms = 120) {
  await page.keyboard.down(name);
  await page.waitForTimeout(ms);
  await page.keyboard.up(name);
  await page.waitForTimeout(120);
}
for (const profile of profiles) {
  test(`${profile.genre} actual WebGL controls, pause and core mechanic`, async ({
    page,
  }) => {
    test.setTimeout(240000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 960, height: 600 });
    await page.goto(`${base}/${profile.genre}/`);
    await expect
      .poll(async () => (await state(page))?.runtime, { timeout: 150000 })
      .toBe(profile.runtime);
    expect((await state(page)).phase).toBe('ready');
    expect((await state(page)).specVersionId).toBe(
      `acceptance-${profile.genre}`,
    );
    await page.screenshot({ path: `${directory}/${profile.genre}-ready.png` });
    const startY =
      profile.genre === 'runner'
        ? 386
        : profile.runtime === 'arena-v1'
          ? 393
          : profile.genre === 'clicker'
            ? 482
            : 420;
    await page.mouse.click(480, startY);
    await expect.poll(async () => (await state(page)).phase).toBe('playing');
    if (profile.genre === 'clicker') await page.mouse.click(850, 538);
    else await key(page, 'p', 60);
    await expect.poll(async () => (await state(page)).phase).toBe('paused');
    const paused = await state(page);
    await page.waitForTimeout(400);
    expect((await state(page)).elapsed).toBe(paused.elapsed);
    if (profile.genre === 'clicker') await page.mouse.click(850, 538);
    else await key(page, 'p', 60);
    await expect.poll(async () => (await state(page)).phase).toBe('playing');
    if (profile.genre === 'runner' || profile.genre === 'platformer') {
      const before = await state(page);
      await key(page, 'd', 180);
      expect((await state(page)).x).toBeGreaterThan(before.x);
      await page.keyboard.down('Space');
      await page.waitForTimeout(180);
      expect((await state(page)).y).toBeGreaterThan(before.y);
      await page.keyboard.up('Space');
    } else if (profile.runtime === 'arena-v1') {
      const before = await state(page);
      await key(page, 'd', 200);
      expect((await state(page)).x).toBeGreaterThan(before.x);
      if (profile.genre === 'top_down_shooter') {
        await page.mouse.move(850, 300);
        await key(page, 'Space', 900);
        expect((await state(page)).attacks).toBeGreaterThan(0);
      } else
        await expect
          .poll(async () => (await state(page)).attacks, { timeout: 15000 })
          .toBeGreaterThan(0);
    } else if (profile.genre === 'clicker') {
      const before = await state(page);
      await page.mouse.click(500, 407);
      await expect
        .poll(async () => (await state(page)).total)
        .toBeGreaterThan(before.total);
      await page.mouse.click(500, 407);
      await page.mouse.click(500, 407);
      await page.mouse.click(760, 407);
      await expect
        .poll(async () => (await state(page)).wallet)
        .toBeLessThan(30);
    } else if (profile.genre === 'flappy') {
      const before = await state(page);
      await key(page, 'Space', 100);
      expect((await state(page)).y).toBeGreaterThan(before.y);
      await expect
        .poll(async () => (await state(page)).phase, { timeout: 8000 })
        .toBe('lost');
      await page.mouse.click(480, 420);
      await expect.poll(async () => (await state(page)).score).toBe(0);
    } else if (profile.genre === 'breakout') {
      const before = await state(page);
      await key(page, 'd', 180);
      expect((await state(page)).x).toBeGreaterThan(before.x);
      await key(page, 'Space', 300);
      expect((await state(page)).y).toBeGreaterThan(1.5);
    } else if (profile.genre === 'tower_defense') {
      await page.mouse.click(160, 338);
      await expect.poll(async () => (await state(page)).currency).toBe(70);
      await page.mouse.click(160, 338);
      await expect.poll(async () => (await state(page)).currency).toBe(40);
    } else if (profile.genre === 'puzzle') {
      const mapping: Record<string, string> = {
        L: 'ArrowLeft',
        R: 'ArrowRight',
        U: 'ArrowUp',
        D: 'ArrowDown',
      };
      for (const move of 'LUURDRRU')
        await key(page, mapping[move] ?? 'ArrowLeft', 50);
      await expect.poll(async () => (await state(page)).phase).toBe('won');
      await page.screenshot({ path: `${directory}/puzzle-won.png` });
      await page.mouse.click(480, 420);
      await expect.poll(async () => (await state(page)).score).toBe(0);
    } else if (profile.genre === 'rpg_dialogue') {
      for (const [y, node] of [
        [360, 1],
        [360, 0],
        [425, 2],
        [360, 3],
      ]) {
        await page.mouse.click(500, y ?? 360);
        await expect.poll(async () => (await state(page)).node).toBe(node);
      }
      expect((await state(page)).hasKey).toBe(true);
      expect((await state(page)).phase).toBe('won');
      await page.screenshot({ path: `${directory}/dialogue-won.png` });
      await page.mouse.click(480, 420);
      await expect.poll(async () => (await state(page)).hasKey).toBe(false);
    }
    const final = await state(page);
    await page.screenshot({
      path: `${directory}/${profile.genre}-playing.png`,
    });
    expect(errors).toEqual([]);
    await writeFile(
      `${directory}/${profile.genre}-browser.json`,
      JSON.stringify(
        {
          genre: profile.genre,
          paused,
          final,
          errors,
          verifiedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  });
}

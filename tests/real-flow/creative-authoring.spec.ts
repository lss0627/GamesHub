import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreativeDocument, DesignDocument } from '@gamerhub/game-spec';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

type RuntimeCreative = {
  contentHash: string;
  phase: string;
  nodes: number;
  clips: number;
  sounds: number;
  time: number;
  muted: boolean;
  voices: number;
  events: number;
  poses: Array<{ id: string; y: number; frame: number }>;
};
type GameState = {
  phase: string;
  total: number;
  perClick: number;
  elapsed: number;
};
type Evidence = {
  status: string;
  projectId?: string;
  runId?: string;
  preview?: string;
  document?: CreativeDocument;
  appliedSpec?: unknown;
  audioPeak?: number;
  finishedAt?: string;
};

function musicWav() {
  const rate = 22050,
    frames = rate * 2,
    bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const frequency =
      [440, 554.37, 659.25, 880][Math.floor(i / (rate * 0.5))] ?? 440;
    const envelope = Math.min(
      1,
      (i % (rate / 2)) / 200,
      (rate / 2 - (i % (rate / 2))) / 200,
    );
    bytes.writeInt16LE(
      Math.round(
        Math.sin((i * frequency * 2 * Math.PI) / rate) * 6000 * envelope,
      ),
      44 + i * 2,
    );
  }
  return bytes;
}

test('real visual authoring, AI suggestion, Unity delivery and audible playback', async ({
  page,
  request,
  context,
}) => {
  test.skip(
    process.env.GAMERHUB_REAL_FLOW !== '1',
    'Requires the actual local stack',
  );
  test.setTimeout(30 * 60 * 1000);
  const directory = 'artifacts/creative-authoring';
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'real-flow.json');
  const evidence: Evidence =
    process.env.GAMERHUB_CREATIVE_RESUME === '1'
      ? JSON.parse(await readFile(path, 'utf8'))
      : { status: 'running' };
  const save = () => writeFile(path, JSON.stringify(evidence, null, 2));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1550, height: 1100 });
  if (!evidence.projectId) {
    const response = await request.post('/v1/projects', {
      data: { name: '星光工坊 · 创作验收' },
    });
    expect(response.status()).toBe(201);
    evidence.projectId = (await response.json()).id;
    await save();
    await page.goto(`/projects/${evidence.projectId}`);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith('/design/messages') &&
        response.request().method() === 'POST',
      { timeout: 150000 },
    );
    await page
      .getByLabel('和 AI 讨论你的游戏')
      .fill(
        '做一个点击收集星星的游戏，名字叫“星光工坊”，每次点击增加10星星，目标50，时长30秒，没有自动收入，升级费用30。',
      );
    await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
    const designResponse = await responsePromise;
    expect(designResponse.ok()).toBeTruthy();
    const design = (await designResponse.json()) as DesignDocument;
    expect(design.brief.genre).toBe('clicker');
    await page.getByRole('button', { name: '场景与动效', exact: true }).click();
    await page.getByRole('button', { name: '添加文字', exact: true }).click();
    await page.getByLabel('对象名称').fill('星光招牌');
    await page.getByLabel('文字内容').fill('星光工坊');
    for (const [label, value] of [
      ['位置 X', '780'],
      ['位置 Y', '135'],
      ['宽度', '230'],
      ['高度', '50'],
    ]) {
      await page.getByLabel(label, { exact: true }).fill(value);
      await page.getByLabel(label, { exact: true }).blur();
    }
    await page
      .getByRole('button', { name: '添加漂浮动画', exact: true })
      .click();
    await page.getByRole('button', { name: '保存创作', exact: true }).click();
    await expect(
      page.getByText('创作已保存，制作后会出现在试玩中。', { exact: true }),
    ).toBeVisible();
    // A small original fixture sheet checks real sprite frame import/playback.
    const raw = Buffer.alloc(16 * 16 * 4);
    const colors = [
      [255, 80, 90],
      [80, 235, 170],
      [90, 160, 255],
      [255, 210, 90],
    ];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const c = colors[Math.floor(x / 8) + Math.floor(y / 8) * 2] ?? [];
        const at = (y * 16 + x) * 4;
        raw[at] = c[0] ?? 0;
        raw[at + 1] = c[1] ?? 0;
        raw[at + 2] = c[2] ?? 0;
        raw[at + 3] = 255;
      }
    const png = await sharp(raw, {
      raw: { width: 16, height: 16, channels: 4 },
    })
      .png()
      .toBuffer();
    const upload = await request.post(
      `/v1/projects/${evidence.projectId}/assets`,
      {
        data: {
          name: '星星精灵表.png',
          mime_type: 'image/png',
          bytes_base64: png.toString('base64'),
          license_text:
            'Original programmatic acceptance fixture, permitted for this project.',
        },
      },
    );
    expect(upload.status()).toBe(201);
    await page.getByRole('button', { name: '玩法与方案', exact: true }).click();
    await page.getByRole('button', { name: '场景与动效', exact: true }).click();
    await page.getByText('图片素材库 · 点击加入场景', { exact: true }).click();
    await page
      .getByRole('button', { name: '星星精灵表.png', exact: true })
      .click();
    await page.getByLabel('对象名称').fill('星星帧动画');
    for (const [label, value] of [
      ['位置 X', '90'],
      ['位置 Y', '130'],
      ['宽度', '64'],
      ['高度', '64'],
      ['精灵表列数', '2'],
      ['精灵表行数', '2'],
    ]) {
      await page.getByLabel(label, { exact: true }).fill(value);
      await page.getByLabel(label, { exact: true }).blur();
    }
    await page
      .getByRole('button', { name: '添加漂浮动画', exact: true })
      .click();
    await page.getByLabel('动画属性', { exact: true }).selectOption('frame');
    for (const [time, value] of [
      [0, 0],
      [0.5, 1],
      [1, 2],
      [1.5, 3],
      [2, 0],
    ]) {
      await page.getByLabel('动画播放位置').fill(String(time));
      await page
        .getByRole('button', { name: '在此时刻添加关键帧', exact: true })
        .click();
      const input = page.getByLabel(`关键帧 ${time.toFixed(2)} 秒的值`);
      await input.fill(String(value));
      await input.blur();
    }
    await page.getByLabel('我有权使用并发布所选音频').check();
    await page.getByLabel('导入音乐或音效').setInputFiles({
      name: '星光背景.wav',
      mimeType: 'audio/wav',
      buffer: musicWav(),
    });
    await page
      .getByRole('button', { name: '星光背景.wav', exact: true })
      .click();
    const music = page.getByRole('group', {
      name: '星光背景.wav',
      exact: true,
    });
    await music.getByLabel('声音触发 星光背景.wav').selectOption('start');
    await music.getByLabel('循环', { exact: true }).check();
    await page.getByRole('button', { name: '添加提示音', exact: true }).click();
    await page.getByRole('button', { name: '保存创作', exact: true }).click();
    await expect(
      page.getByText('创作已保存，制作后会出现在试玩中。', { exact: true }),
    ).toBeVisible();
    const beforeSuggestion = (
      await (
        await request.get(`/v1/projects/${evidence.projectId}/creative`)
      ).json()
    ).document as CreativeDocument;
    await page
      .getByLabel('描述场景动画声音')
      .fill(
        '保留所有现有对象、动画和声音及其全部数值，只为星光招牌新增名为“胜利闪光”的动画，win触发，不透明度从1到0.4再到1，关键帧时间0、0.5、1秒，时长1秒，不循环。其他内容保持原样。',
      );
    const suggestPromise = page.waitForResponse(
      (response) => response.url().endsWith('/creative/suggest'),
      { timeout: 150000 },
    );
    await page
      .getByRole('button', { name: '生成编排建议', exact: true })
      .click();
    const suggestedResponse = await suggestPromise;
    expect(suggestedResponse.ok()).toBeTruthy();
    const suggestion = (await suggestedResponse.json())
      .document as CreativeDocument;
    expect(suggestion.nodes).toEqual(beforeSuggestion.nodes);
    expect(suggestion.sounds).toEqual(beforeSuggestion.sounds);
    expect(
      suggestion.clips.filter((c) =>
        beforeSuggestion.clips.some((b) => b.id === c.id),
      ),
    ).toEqual(beforeSuggestion.clips);
    expect(suggestion.clips.some((c) => c.trigger === 'win')).toBeTruthy();
    await page.getByRole('button', { name: '采用到画布', exact: true }).click();
    await page
      .getByRole('application', { name: '场景画布' })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(directory, 'editor.png') });
    const applyPromise = page.waitForResponse(
      (response) => response.url().endsWith('/creative/apply'),
      { timeout: 150000 },
    );
    await page
      .getByRole('button', { name: '保存并制作试玩', exact: true })
      .click();
    const applied = await applyPromise;
    expect(applied.status()).toBe(202);
    const accepted = (await applied.json()) as DesignDocument;
    evidence.runId = accepted.confirmedRunId;
    evidence.document = suggestion;
    evidence.appliedSpec = accepted.spec;
    await save();
  }
  if (!evidence.runId) throw new Error('ACCEPTANCE_RUN_ID_REQUIRED');
  await expect
    .poll(
      async () => {
        const response = await request
          .get(`/v1/projects/${evidence.projectId}/runs/${evidence.runId}`)
          .catch(() => undefined);
        if (
          !response?.ok() ||
          !response.headers()['content-type']?.includes('application/json')
        )
          return 'temporarily_unavailable';
        const run = await response.json();
        if (
          ['failed', 'timed_out', 'cancelled', 'partially_succeeded'].includes(
            run.status,
          )
        )
          throw new Error(`ACTUAL_RUN_${run.status}:${run.result_summary}`);
        if (run.status === 'succeeded') {
          evidence.preview = run.result_summary;
          await save();
        }
        return run.status;
      },
      { timeout: 24 * 60 * 1000, intervals: [5000] },
    )
    .toBe('succeeded');
  await page.goto(`/projects/${evidence.projectId}`);
  await page.getByRole('button', { name: '试玩游戏', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '本次交付已通过验证' }),
  ).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: join(directory, 'delivered.png') });
  const game = await context.newPage();
  await game.setViewportSize({ width: 960, height: 600 });
  game.on('pageerror', (e) => errors.push(e.message));
  // Observe actual Web Audio output without changing gain, source data or game state.
  await game.addInitScript(() => {
    const state = { peak: 0 };
    (window as unknown as { __audioEvidence: typeof state }).__audioEvidence =
      state;
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (
      ...args: Parameters<AudioNode['connect']>
    ) {
      const destination = args[0];
      if (destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 256;
        connect.call(this, analyser);
        const data = new Float32Array(analyser.fftSize);
        setInterval(() => {
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (const sample of data) sum += sample * sample;
          state.peak = Math.max(state.peak, Math.sqrt(sum / data.length));
        }, 20);
      }
      return Reflect.apply(connect, this, args);
    } as AudioNode['connect'];
  });
  await game.goto(evidence.preview as string);
  await game.waitForFunction(
    () =>
      Boolean(
        (window as unknown as { __gamerhubCreativeState?: unknown })
          .__gamerhubCreativeState,
      ),
    undefined,
    { timeout: 180000 },
  );
  const creative = () =>
    game.evaluate(
      () =>
        (window as unknown as { __gamerhubCreativeState: RuntimeCreative })
          .__gamerhubCreativeState,
    );
  const state = () =>
    game.evaluate(
      () =>
        (window as unknown as { __gamerhubGameState: GameState })
          .__gamerhubGameState,
    );
  expect((await creative()).nodes).toBe(evidence.document?.nodes.length);
  const canvas = game.locator('canvas').first();
  const readyImage = await canvas.screenshot();
  await writeFile(join(directory, 'ready.png'), readyImage);
  const readyPixels = await sharp(
    await sharp(readyImage)
      .extract({ left: 88, top: 128, width: 4, height: 4 })
      .toBuffer(),
  ).stats();
  expect(
    readyPixels.channels[0]?.mean,
    'The authored red sprite must be visibly rendered above the gameplay UI',
  ).toBeGreaterThan(170);
  expect(readyPixels.channels[1]?.mean).toBeLessThan(130);
  expect(readyPixels.channels[2]?.mean).toBeLessThan(150);
  const click = async (x: number, y: number) => {
    const box = await canvas.boundingBox();
    if (!box) throw new Error('CANVAS_MISSING');
    await game.mouse.click(
      box.x + (box.width * x) / 960,
      box.y + (box.height * y) / 600,
    );
  };
  await click(480, 482);
  await expect.poll(async () => (await state()).phase).toBe('playing');
  const first = await creative();
  await expect
    .poll(
      async () =>
        (await creative()).poses.find(
          (p) => p.id === evidence.document?.nodes[0]?.id,
        )?.y,
    )
    .not.toBe(
      first.poses.find((p) => p.id === evidence.document?.nodes[0]?.id)?.y,
    );
  const frames = new Set<number>();
  for (let i = 0; i < 12; i++) {
    const pose = (await creative()).poses.find(
      (p) =>
        p.id === evidence.document?.nodes.find((n) => n.kind === 'sprite')?.id,
    );
    if (pose) frames.add(pose.frame);
    await game.waitForTimeout(120);
  }
  expect(frames.size).toBeGreaterThan(2);
  await expect
    .poll(() =>
      game.evaluate(
        () =>
          (window as unknown as { __audioEvidence: { peak: number } })
            .__audioEvidence.peak,
      ),
    )
    .toBeGreaterThan(0.001);
  evidence.audioPeak = await game.evaluate(
    () =>
      (window as unknown as { __audioEvidence: { peak: number } })
        .__audioEvidence.peak,
  );
  await save();
  await game.screenshot({ path: join(directory, 'playing.png') });
  await click(850, 538);
  await expect.poll(async () => (await creative()).phase).toBe('paused');
  const paused = await creative();
  await game.waitForTimeout(500);
  expect((await creative()).time).toBe(paused.time);
  expect((await creative()).voices).toBe(0);
  await click(850, 538);
  await expect.poll(async () => (await creative()).phase).toBe('playing');
  await game.keyboard.down('m');
  await game.waitForTimeout(100);
  await game.keyboard.up('m');
  await expect.poll(async () => (await creative()).muted).toBe(true);
  await game.keyboard.down('m');
  await game.waitForTimeout(100);
  await game.keyboard.up('m');
  await expect.poll(async () => (await creative()).muted).toBe(false);
  const before = await state();
  const priorEvents = (await creative()).events;
  await click(500, 407);
  await expect
    .poll(async () => (await state()).total)
    .toBe(before.total + before.perClick);
  await expect
    .poll(async () => (await creative()).events)
    .toBeGreaterThan(priorEvents);
  for (let i = 0; i < 12 && (await state()).phase === 'playing'; i++) {
    await click(500, 407);
    await game.waitForTimeout(120);
  }
  await expect.poll(async () => (await state()).phase).toBe('won');
  await game.screenshot({ path: join(directory, 'won.png') });
  await click(480, 482);
  await expect.poll(async () => (await state()).phase).toBe('playing');
  expect((await state()).total).toBe(0);
  expect((await creative()).time).toBeLessThan(1);
  await game.close();
  expect(errors).toEqual([]);
  evidence.status = 'passed';
  evidence.finishedAt = new Date().toISOString();
  await save();
});

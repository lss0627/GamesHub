import { resolve } from 'node:path';
import type { ArtView } from '../../apps/studio-web/src/features/creator/ArtStudio';
import {
  type ArtCandidate,
  type ArtPlan,
  bindCandidate,
  buildDesignSpec,
  type DesignDocument,
  initialBrief,
} from '../../packages/game-spec/src/index';
import { expect, type Page, readyHealth, test } from './fixtures';

const configuredImageProvider = {
  id: 'image-provider',
  name: 'OpenAI 图片生成',
  available: true,
  provider: 'openai',
  model: 'image-model',
  reasonCode: 'ART_PROVIDER_READY',
  configurationOnly: true,
};

async function openProviderStudio(
  page: Page,
  readPlan: () => ArtView | Promise<ArtView>,
  generate?: (body: { prompt: string; source: string }) => ArtView,
  resume?: (body: { revision: number }) => ArtView,
) {
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/art/generate') && generate)
      return route.fulfill({
        status: 202,
        json: generate(route.request().postDataJSON()),
      });
    if (path.endsWith('/art/resume') && resume)
      return route.fulfill({
        status: 202,
        json: resume(route.request().postDataJSON()),
      });
    if (path.endsWith('/art')) return route.fulfill({ json: await readPlan() });
    if (path.endsWith('/design'))
      return route.fulfill({
        json: { revision: 0, brief: initialBrief, choices: [], messages: [] },
      });
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto('/projects/image-capability');
  await page.getByRole('button', { name: '角色与素材', exact: true }).click();
}

test('missing image configuration leaves built-in creation available', async ({
  page,
}) => {
  await page.route('**/api/gamerhub/health', (route) =>
    route.fulfill({
      json: {
        ...readyHealth,
        services: {
          ...readyHealth.services,
          images: {
            status: 'blocked',
            optional: true,
            configurationOnly: true,
            builtinAvailable: true,
          },
        },
      },
    }),
  );
  await openProviderStudio(page, () => ({
    revision: 0,
    status: 'empty',
    prompt: '',
    requirements: [],
    candidates: [],
    providers: [
      {
        ...configuredImageProvider,
        available: false,
        reasonCode: 'ART_PROVIDER_KEY_REQUIRED',
      },
    ],
  }));
  await expect(
    page.locator('#art-source option[value="image-provider"]'),
  ).toBeDisabled();
  await expect(page.getByLabel('素材来源')).toHaveValue('builtin');
  await expect(page.locator('#art-provider-status')).toContainText(
    '缺少 API 密钥',
  );
  await expect(
    page.getByRole('button', { name: '自动准备两组素材 →' }),
  ).toBeEnabled();
  await expect(page.getByTestId('art-generation-cost')).toHaveCount(0);
  const readiness = page.getByRole('region', { name: '创作环境' });
  await expect(readiness).toContainText('创作环境已连接');
  await readiness.locator('summary').click();
  await expect(
    readiness.getByRole('listitem').filter({ hasText: '外部生图（可选）' }),
  ).toContainText('配置需检查');
});

test('configured external images show unverified status and request count before generation', async ({
  page,
}) => {
  let requestCount = 0;
  let requestedSource = '';
  await page.route('**/api/gamerhub/health', (route) =>
    route.fulfill({
      json: {
        ...readyHealth,
        services: {
          ...readyHealth.services,
          images: {
            status: 'ready',
            provider: 'openai',
            model: 'image-model',
            optional: true,
            configurationOnly: true,
            builtinAvailable: true,
          },
        },
      },
    }),
  );
  let plan: ArtView = {
    revision: 0,
    status: 'empty',
    prompt: '',
    requirements: [],
    candidates: [],
    providers: [configuredImageProvider],
  };
  await openProviderStudio(
    page,
    () => plan,
    (body) => {
      requestCount++;
      requestedSource = body.source;
      plan = { ...plan, revision: 1, status: 'ready', prompt: body.prompt };
      return plan;
    },
  );
  await expect(page.locator('#art-provider-status')).toContainText(
    'OpenAI 图片生成 · image-model',
  );
  await expect(page.locator('#art-provider-status')).toContainText(
    '配置已检测，尚未验证连接',
  );
  const readiness = page.getByRole('region', { name: '创作环境' });
  await readiness.locator('summary').click();
  const imageReadiness = readiness
    .getByRole('listitem')
    .filter({ hasText: '外部生图（可选）' });
  await expect(imageReadiness).toContainText('配置已检测');
  await expect(imageReadiness).toContainText('尚未验证连接');
  await expect(imageReadiness).not.toContainText('已连接');
  await page.getByLabel('素材来源').selectOption('image-provider');
  await expect(page.getByTestId('art-generation-cost')).toContainText(
    '2 组 × 4 张',
  );
  await expect(page.getByTestId('art-generation-cost')).toContainText(
    '8 次外部生图请求',
  );
  await expect(page.getByTestId('art-generation-cost')).toContainText(
    '可能产生费用',
  );
  expect(requestCount).toBe(0);
  await page.getByRole('button', { name: '自动准备两组素材 →' }).click();
  await expect.poll(() => requestCount).toBe(1);
  expect(requestedSource).toBe('image-provider');
});

test('a selected image provider that loses configuration blocks generation until the user switches', async ({
  page,
}) => {
  let provider = { ...configuredImageProvider };
  await openProviderStudio(page, () => ({
    revision: 0,
    status: 'empty',
    prompt: '',
    requirements: [],
    candidates: [],
    providers: [provider],
  }));
  await page.getByLabel('素材来源').selectOption('image-provider');
  provider = {
    ...provider,
    available: false,
    reasonCode: 'ART_PROVIDER_NOT_CONFIGURED',
  };
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  );
  await expect(page.locator('#art-provider-status')).toContainText(
    '当前选择的图片服务已不可用',
  );
  await expect(page.getByLabel('素材来源')).toHaveValue('image-provider');
  await expect(
    page.getByRole('button', { name: '自动准备两组素材 →' }),
  ).toBeDisabled();
  await page.getByLabel('素材来源').selectOption('builtin');
  await expect(
    page.getByRole('button', { name: '自动准备两组素材 →' }),
  ).toBeEnabled();
});

test('art drafts survive reload and stay isolated between projects', async ({
  page,
}) => {
  await openProviderStudio(page, () => ({
    revision: 2,
    status: 'ready',
    prompt: '服务端已提交的森林描述',
    requirements: [],
    candidates: [],
    providers: [configuredImageProvider],
  }));
  const prompt = page.getByLabel('希望游戏看起来是什么感觉？');
  await expect(prompt).toHaveValue('服务端已提交的森林描述');
  await prompt.fill('尚未提交的蓝色月夜');
  await page.getByLabel('素材来源').selectOption('image-provider');
  await page.reload();
  await page.getByRole('button', { name: '角色与素材', exact: true }).click();
  await expect(prompt).toHaveValue('尚未提交的蓝色月夜');
  await expect(page.getByLabel('素材来源')).toHaveValue('image-provider');

  await page.goto('/projects/another-art-project');
  await page.getByRole('button', { name: '角色与素材', exact: true }).click();
  await expect(prompt).toHaveValue('服务端已提交的森林描述');
  await expect(page.getByLabel('素材来源')).toHaveValue('builtin');
  await prompt.fill('另一个项目的草稿');
  await page.goto('/projects/image-capability');
  await page.getByRole('button', { name: '角色与素材', exact: true }).click();
  await expect(prompt).toHaveValue('尚未提交的蓝色月夜');
  await expect(page.getByLabel('素材来源')).toHaveValue('image-provider');
});

test('a delayed first art read does not replace text already being edited', async ({
  page,
}) => {
  let release: ((plan: ArtView) => void) | undefined;
  const initialRead = new Promise<ArtView>((resolve) => {
    release = resolve;
  });
  await openProviderStudio(page, () => initialRead);
  const prompt = page.getByLabel('希望游戏看起来是什么感觉？');
  await prompt.fill('我正在编辑的新草稿');
  release?.({
    revision: 5,
    status: 'ready',
    prompt: '旧的已提交描述',
    requirements: [],
    candidates: [],
    providers: [configuredImageProvider],
  });
  await expect(page.locator('#art-provider-status')).toContainText(
    '配置已检测',
  );
  await expect(prompt).toHaveValue('我正在编辑的新草稿');
  await page.reload();
  await page.getByRole('button', { name: '角色与素材', exact: true }).click();
  await expect(prompt).toHaveValue('我正在编辑的新草稿');
});

test('failed image preparation resumes saved progress explicitly with the original request', async ({
  page,
}) => {
  let resumes = 0;
  let generations = 0;
  let resumeBody: unknown;
  let plan: ArtView = {
    revision: 7,
    status: 'failed',
    prompt: '原始的温暖森林',
    requirements: [],
    candidates: [],
    providers: [configuredImageProvider],
    errorCode: 'ART_PROVIDER_TIMEOUT',
    resumeAvailable: true,
    generation: {
      id: 'generation-a',
      source: 'image-provider',
      provider: 'openai',
      model: 'image-model',
      fingerprint: 'test-configuration',
      requirements: [],
      styles: ['night', 'dusk'],
      candidates: [],
      phase: 'images',
      completed: 3,
      total: 8,
      active: { style: 'night', role: 'stump' },
    },
  };
  await openProviderStudio(
    page,
    () => plan,
    () => {
      generations++;
      return plan;
    },
    (body) => {
      resumes++;
      resumeBody = body;
      plan = {
        ...plan,
        revision: 8,
        status: 'generating',
        resumeAvailable: false,
      };
      return plan;
    },
  );
  const resume = page.getByTestId('art-resume');
  await expect(resume).toContainText('已保存 3/8 张');
  await expect(resume).toContainText('跳过已成功保存的图片');
  await expect(resume).toContainText('原始的温暖森林');
  await expect(page.getByTestId('art-resume-cost')).toContainText(
    '还需准备 5 张',
  );
  await expect(page.getByTestId('art-resume-cost')).toContainText(
    '也可能已经计费',
  );
  expect(resumes).toBe(0);
  await page
    .getByLabel('希望游戏看起来是什么感觉？')
    .fill('下一次使用的冰雪草稿');
  await page.getByLabel('素材来源').selectOption('builtin');
  await page.getByRole('button', { name: '继续上次准备（剩余 5 张）' }).click();
  await expect(page.getByTestId('art-progress')).toContainText('已保存 3/8 张');
  await expect(page.getByTestId('art-progress')).toContainText(
    '月夜 · 对手/障碍',
  );
  await expect(
    page.getByRole('progressbar', { name: '素材准备进度' }),
  ).toHaveAttribute('value', '3');
  expect(resumeBody).toEqual({ revision: 7 });
  expect(resumes).toBe(1);
  expect(generations).toBe(0);
  await expect(page.getByLabel('希望游戏看起来是什么感觉？')).toHaveValue(
    '下一次使用的冰雪草稿',
  );
});

test('unavailable resume explains provider changes and incomplete candidates cannot be selected', async ({
  page,
}) => {
  await openProviderStudio(page, () => ({
    revision: 2,
    status: 'failed',
    prompt: '森林',
    requirements: [],
    candidates: [
      {
        id: 'partial',
        name: '尚未完成',
        source: 'image-provider',
        style: 'night',
        assets: [
          {
            role: 'cat',
            assetId: 'one-image',
            name: '角色',
            contentHash: `sha256-${'a'.repeat(64)}`,
          },
        ],
      },
    ],
    providers: [configuredImageProvider],
    errorCode: 'ART_GENERATION_INTERRUPTED',
    resumeAvailable: false,
    resumeReasonCode: 'ART_RESUME_PROVIDER_CHANGED',
    generation: {
      id: 'generation-a',
      source: 'image-provider',
      provider: 'openai',
      fingerprint: 'test-configuration',
      requirements: [],
      styles: ['night', 'dusk'],
      candidates: [],
      phase: 'images',
      completed: 1,
      total: 8,
    },
  }));
  await expect(page.getByTestId('art-resume')).toContainText(
    '图片服务或模型已变化',
  );
  await expect(page.getByRole('button', { name: /继续上次准备/ })).toHaveCount(
    0,
  );
  await expect(page.locator('[data-candidate-id="partial"]')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '按当前描述重新准备两组（8 张）' }),
  ).toBeEnabled();
});

test('art polling pauses while hidden, refreshes when visible and never overlaps', async ({
  page,
}) => {
  await page.clock.install();
  let reads = 0;
  let release: (() => void) | undefined;
  let holdRead = false;
  await openProviderStudio(page, async () => {
    reads++;
    if (holdRead)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return {
      revision: reads,
      status: 'ready',
      prompt: '森林',
      requirements: [],
      candidates: [],
    };
  });
  await expect(page.getByLabel('希望游戏看起来是什么感觉？')).toHaveValue(
    '森林',
  );
  const initialReads = reads;
  await page.clock.runFor(2600);
  expect(reads).toBe(initialReads);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(20000);
  expect(reads).toBe(initialReads);
  holdRead = true;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => reads).toBe(initialReads + 1);
  expect(release).toBeDefined();
  holdRead = false;
  release?.();
  await expect.poll(() => reads).toBe(initialReads + 2);
});

for (const [code, guidance] of [
  ['ART_PROVIDER_AUTH_FAILED', '鉴权失败'],
  ['ART_PROVIDER_RATE_LIMITED', '请求过于频繁'],
  ['ART_PROVIDER_REQUEST_REJECTED', '账户额度'],
  ['ART_PROVIDER_TIMEOUT', '等待超时'],
  ['ART_PROVIDER_INVALID', '没有返回可用图片'],
] as const) {
  test(`image failure ${code} shows safe guidance and keeps the prompt`, async ({
    page,
  }) => {
    let plan: ArtView = {
      revision: 0,
      status: 'empty',
      prompt: '',
      requirements: [],
      candidates: [],
      providers: [configuredImageProvider],
    };
    await openProviderStudio(
      page,
      () => plan,
      (body) => {
        plan = {
          ...plan,
          revision: 1,
          status: 'failed',
          prompt: body.prompt,
          errorCode: code,
        };
        return {
          ...plan,
          detail: 'secret upstream provider response',
        } as ArtView;
      },
    );
    await page.getByLabel('素材来源').selectOption('image-provider');
    await page.getByLabel('希望游戏看起来是什么感觉？').fill('安静的月色森林');
    await page.getByRole('button', { name: '自动准备两组素材 →' }).click();
    await expect(
      page.getByRole('region', { name: '自动素材工作室' }).getByRole('alert'),
    ).toContainText(guidance);
    await expect(
      page.getByRole('region', { name: '自动素材工作室' }),
    ).not.toContainText('secret upstream');
    await expect(page.getByLabel('希望游戏看起来是什么感觉？')).toHaveValue(
      '安静的月色森林',
    );
  });
}

for (const mobile of [false, true]) {
  test(`automatic art can be reviewed before any build (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    let confirms = 0;
    let plan: ArtPlan = {
      revision: 0,
      status: 'empty',
      prompt: '',
      requirements: [],
      candidates: [],
    };
    let design: DesignDocument = {
      revision: 0,
      brief: { ...initialBrief },
      choices: [],
      messages: [
        { role: 'user', content: '想做猫咪跑酷' },
        { role: 'assistant', content: '我们先做轻松的跑酷。' },
        { role: 'user', content: '60秒慢一点' },
      ],
    };
    await page.route('**/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body =
        route.request().method() === 'POST'
          ? route.request().postDataJSON()
          : undefined;
      if (path.endsWith('/content'))
        return route.fulfill({
          path: resolve('apps/studio-web/public/runner-art/cat.png'),
        });
      if (path.endsWith('/art/generate')) {
        plan = {
          ...plan,
          revision: plan.revision + 1,
          status: 'ready',
          prompt: body.prompt,
          requirements: ['cat', 'forest', 'coin', 'stump'].map((role) => ({
            role: role as 'cat',
            description: '用途与画风说明',
          })),
          candidates: ['月色森林', '暮色花园'].map((name, index) => ({
            id: `candidate-${index}`,
            name,
            style: 'night',
            source: 'builtin',
            assets: ['cat', 'forest', 'coin', 'stump'].map((role, i) => ({
              role: role as 'cat',
              assetId: `00000000-0000-4000-8000-00000000000${i + 1}`,
              name: role,
              contentHash: `sha256-${'a'.repeat(64)}`,
            })),
          })),
        };
        return route.fulfill({ status: 202, json: plan });
      }
      if (path.endsWith('/art/select')) {
        expect(body.revision).toBe(plan.revision);
        plan = {
          ...plan,
          revision: plan.revision + 1,
          selectedCandidateId: body.candidateId,
        };
        design = {
          ...design,
          revision: design.revision + 1,
          spec: undefined,
          markdown: undefined,
        };
        return route.fulfill({ json: plan });
      }
      if (path.endsWith('/art')) return route.fulfill({ json: plan });
      if (path.endsWith('/design/prepare')) {
        design = {
          ...design,
          revision: design.revision + 1,
          spec: bindCandidate(
            buildDesignSpec(design.brief),
            plan.candidates[0],
          ),
          markdown: '已确认的美术方案：月色森林',
        };
        return route.fulfill({ json: design });
      }
      if (path.endsWith('/design/confirm')) {
        confirms++;
        return route.fulfill({ json: { ...design, confirmedRunId: 'run' } });
      }
      if (path.endsWith('/design')) return route.fulfill({ json: design });
      if (
        path.endsWith('/runs') ||
        path.endsWith('/assets') ||
        path.endsWith('/versions')
      )
        return route.fulfill({ json: { items: [] } });
      return route.fulfill({ json: { id: 'project-art' } });
    });
    await page.goto('/projects/project-art');
    await page.getByRole('button', { name: '角色与素材', exact: true }).click();
    await page.getByLabel('希望游戏看起来是什么感觉？').fill('柔和的月色森林');
    await page
      .getByRole('button', { name: '自动准备两组素材 →', exact: true })
      .click();
    const candidate = page.locator('[data-candidate-id="candidate-0"]');
    await expect(candidate.locator('img')).toHaveCount(4);
    await expect(candidate).toContainText('尚未应用');
    await candidate.getByRole('button', { name: '选择这一组' }).click();
    await expect(candidate).toContainText('等待确认制作');
    expect(confirms).toBe(0);
    await page.reload();
    await page.getByRole('button', { name: '角色与素材', exact: true }).click();
    await expect(candidate).toContainText('等待确认制作');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole('button', { name: '带着这组素材查看方案 →' }).click();
    await page
      .getByRole('button', { name: '方案聊好了，生成制作说明' })
      .click();
    await expect(
      page.getByRole('region', { name: '制作说明 Spec' }),
    ).toContainText('月色森林');
    expect(confirms).toBe(0);
    await page.getByRole('button', { name: '确认说明，开始制作 →' }).click();
    expect(confirms).toBe(1);
  });
}

for (const mobile of [false, true]) {
  test(`latest art stays first and warehouse reflects the playable version (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const candidates: ArtCandidate[] = [
      '旧晨光',
      '旧暮色',
      '新月夜',
      '新粉紫',
    ].map((name, index) => ({
      id: `art-${index}`,
      name,
      style: 'night',
      source: 'builtin',
      assets: (['cat', 'forest', 'coin', 'stump'] as const).map((role) => ({
        role,
        assetId: `asset-${index}-${role}`,
        name: role === 'cat' ? `${name}猫咪` : role,
        contentHash: `sha256-${'a'.repeat(64)}`,
      })),
    }));
    await page.route('**/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/content'))
        return route.fulfill({
          path: resolve('apps/studio-web/public/runner-art/cat.png'),
        });
      if (path.endsWith('/art'))
        return route.fulfill({
          json: {
            revision: 4,
            status: 'ready',
            prompt: '森林',
            requirements: [],
            candidates,
            selectedCandidateId: 'art-2',
            applied: candidates[0],
          },
        });
      if (path.endsWith('/design'))
        return route.fulfill({
          json: { revision: 0, brief: initialBrief, choices: [], messages: [] },
        });
      if (path.endsWith('/assets'))
        return route.fulfill({
          json: {
            items: candidates.map((candidate) => ({
              id: candidate.assets[0]?.assetId,
              name: candidate.assets[0]?.name,
              importStatus: 'imported',
            })),
          },
        });
      return route.fulfill({ json: { items: [] } });
    });
    await page.goto('/projects/art-history');
    await page.getByRole('button', { name: '角色与素材', exact: true }).click();
    await expect(page.locator('[data-candidate-id]').first()).toHaveAttribute(
      'data-candidate-id',
      'art-2',
    );
    await expect(page.locator('[data-candidate-id="art-2"]')).toContainText(
      '最近准备',
    );
    await expect(page.locator('[data-candidate-id="art-0"]')).toBeHidden();
    await page.locator('.art-history > summary').click();
    await expect(page.locator('[data-candidate-id="art-0"]')).toBeVisible();
    await expect(page.locator('[data-candidate-id="art-0"]')).toContainText(
      '之前的候选',
    );
    await expect(page.locator('[data-candidate-id="art-2"]')).toContainText(
      '等待确认制作',
    );
    await expect(page.locator('[data-candidate-id="art-0"]')).toContainText(
      '当前游戏正在使用',
    );
    const warehouse = page.locator('.studio-uploads');
    await expect(warehouse).toBeVisible();
    await warehouse.locator('summary').click();
    await expect(
      warehouse.locator('.studio-upload-row').filter({ hasText: '旧晨光猫咪' }),
    ).toContainText('当前游戏正在使用');
    await expect(
      warehouse.locator('.studio-upload-row').filter({ hasText: '新月夜猫咪' }),
    ).not.toContainText('当前游戏正在使用');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

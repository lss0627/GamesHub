import {
  emptyCreative,
  initialBrief,
} from '../../packages/game-spec/src/index';
import { expect, test } from './fixtures';

test('scene editing, undo, timeline, save and reload use the same authoring data', async ({
  page,
}) => {
  let saved = emptyCreative();
  let revision = 0;
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/creative')) {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        expect(body.revision).toBe(revision);
        saved = body.document;
        revision++;
      }
      return route.fulfill({
        json: { revision, document: saved, applied: emptyCreative() },
      });
    }
    if (path.endsWith('/design'))
      return route.fulfill({
        json: { revision, brief: initialBrief, messages: [], choices: [] },
      });
    return route.fulfill({
      json:
        path.endsWith('/runs') ||
        path.endsWith('/assets') ||
        path.endsWith('/versions')
          ? { items: [] }
          : { id: 'project-1' },
    });
  });
  await page.goto('/projects/project-1');
  await page.getByRole('button', { name: '场景与动效', exact: true }).click();
  await page.getByRole('button', { name: '添加文字', exact: true }).click();
  await page.getByLabel('对象名称').fill('星光招牌');
  await page.getByLabel('文字内容').fill('欢迎来到星光小铺');
  await page.getByLabel('位置 X').fill('120');
  await page.getByLabel('位置 X').blur();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('位置 X')).toHaveValue('480');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByLabel('位置 X')).toHaveValue('120');
  await page.getByRole('button', { name: '添加漂浮动画', exact: true }).click();
  await page.getByRole('button', { name: '添加提示音', exact: true }).click();
  await page.getByRole('button', { name: '保存创作', exact: true }).click();
  await expect(
    page.getByText('创作已保存，制作后会出现在试玩中。', { exact: true }),
  ).toBeVisible();
  expect(saved.nodes[0]?.text).toBe('欢迎来到星光小铺');
  expect(saved.clips).toHaveLength(1);
  expect(saved.sounds).toHaveLength(1);
  await page.reload();
  await page.getByRole('button', { name: '场景与动效', exact: true }).click();
  await page.getByRole('button', { name: '星光招牌', exact: true }).click();
  await expect(page.getByLabel('位置 X')).toHaveValue('120');
});

test('conflicting save preserves unsaved local edits', async ({ page }) => {
  await page.route('**/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/creative'))
      return route.fulfill(
        route.request().method() === 'POST'
          ? { status: 409, json: { code: 'DESIGN_CHANGED' } }
          : {
              json: {
                revision: 0,
                document: emptyCreative(),
                applied: emptyCreative(),
              },
            },
      );
    if (path.endsWith('/design'))
      return route.fulfill({
        json: { revision: 0, brief: initialBrief, messages: [], choices: [] },
      });
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto('/projects/project-1');
  await page.getByRole('button', { name: '场景与动效', exact: true }).click();
  await page.getByRole('button', { name: '添加文字', exact: true }).click();
  await page.getByLabel('文字内容').fill('保留我的修改');
  await page.getByRole('button', { name: '保存创作', exact: true }).click();
  await expect(
    page.getByRole('region', { name: '场景动画声音编辑器' }).getByRole('alert'),
  ).toContainText('另一处更新');
  await expect(page.getByLabel('文字内容')).toHaveValue('保留我的修改');
});

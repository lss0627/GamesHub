import { initialBrief } from '../../packages/game-spec/src/index';
import { expect, test } from './fixtures';

test('beginner can remember, correct, reload and delete without starting a game', async ({
  page,
}) => {
  let document = {
    revision: 0,
    items: [] as Array<{
      id: string;
      kind: string;
      content: string;
      revision: number;
      source: string;
    }>,
  };
  let conflict = false;
  let starts = 0;
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/agent/memory')) {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        if (conflict) {
          conflict = false;
          document.revision++;
          return route.fulfill({
            status: 409,
            json: { code: 'MEMORY_CHANGED' },
          });
        }
        document = {
          revision: document.revision + 1,
          items:
            body.operation === 'delete'
              ? []
              : [
                  {
                    id: 'memory-1',
                    kind: body.kind,
                    content: body.content,
                    source: 'user',
                    revision: document.revision + 1,
                  },
                ],
        };
      }
      return route.fulfill({ json: document });
    }
    if (path.endsWith('/runs') && route.request().method() === 'POST') starts++;
    if (path.endsWith('/design'))
      return route.fulfill({
        json: { revision: 0, messages: [], choices: [], brief: initialBrief },
      });
    return route.fulfill({ json: { id: 'memory-project', items: [] } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/projects/memory-project');
  const panel = page.locator('.studio-memory');
  await panel.locator('summary').click();
  await page.getByLabel('希望伙伴记住什么').fill('失败后可以立即重试');
  await page.getByRole('button', { name: '记住这条', exact: true }).click();
  await expect(panel.locator('li')).toContainText('失败后可以立即重试');
  await page.reload();
  await panel.locator('summary').click();
  await expect(panel.locator('li')).toContainText('失败后可以立即重试');
  await panel.getByRole('button', { name: '修改', exact: true }).click();
  await page.getByLabel('修改这条记忆').fill('允许跳过教程');
  conflict = true;
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(panel.getByRole('status')).toContainText('已在另一处更新');
  await expect(page.getByLabel('修改这条记忆')).toHaveValue('允许跳过教程');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(panel.locator('li')).toContainText('允许跳过教程');
  await panel.getByRole('button', { name: '删除记忆：允许跳过教程' }).click();
  await expect(panel.locator('li')).toHaveCount(0);
  expect(starts).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

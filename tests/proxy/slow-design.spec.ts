import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import {
  type DesignDocument,
  initialBrief,
} from '../../packages/game-spec/src/index';

let server: Server;
let failNext = false;
let document: DesignDocument;
test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    if (request.url?.endsWith('/design/messages')) {
      if (failNext) {
        failNext = false;
        response.writeHead(500, { 'content-type': 'text/plain' });
        response.end('Internal Server Error');
        return;
      }
      let body = '';
      for await (const chunk of request) body += chunk;
      // Exercise the actual Next rewrite and proxy, including its former 30s cutoff.
      await new Promise((resolve) => setTimeout(resolve, 35_000));
      document = {
        ...document,
        revision: document.revision + 1,
        messages: [
          ...document.messages,
          { role: 'user', content: JSON.parse(body).message },
          { role: 'assistant', content: '已经收到，接下来一起讨论玩法。' },
        ],
      };
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify(
        request.url?.includes('/design') ? document : { items: [] },
      ),
    );
  });
  await new Promise<void>((resolve) =>
    server.listen(3301, '127.0.0.1', resolve),
  );
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
test.beforeEach(() => {
  document = {
    revision: 0,
    brief: { ...initialBrief },
    messages: [],
    choices: [],
  };
  failNext = false;
});

test('a reply after 35 seconds reaches the browser through the real Next proxy', async ({
  page,
}) => {
  await page.goto('/projects/proxy-test');
  const input = page.getByLabel('和 AI 讨论你的游戏');
  await input.fill('请帮我讨论玩法');
  await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
  await expect(
    page.getByText('已经收到，接下来一起讨论玩法。', { exact: true }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(input).toHaveValue('');
  await expect(page.locator('.studio-error')).toHaveCount(0);
});

test('plain-text server failures preserve the input and allow a successful retry', async ({
  page,
}) => {
  failNext = true;
  await page.goto('/projects/proxy-test');
  const input = page.getByLabel('和 AI 讨论你的游戏');
  await input.fill('这个输入不能丢');
  await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: '服务暂时没有响应' }),
  ).toBeVisible();
  await expect(input).toHaveValue('这个输入不能丢');
  await expect(input).toBeEnabled();
  await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
  await expect(
    page.getByText('已经收到，接下来一起讨论玩法。', { exact: true }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(input).toHaveValue('');
  await expect(page.locator('.studio-error')).toHaveCount(0);
});

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { loadEnvironmentFile } from './dev-env';

loadEnvironmentFile();
async function main(): Promise<void> {
  const cycle = JSON.parse(
    await readFile('artifacts/real-flow/cycle.json', 'utf8'),
  );
  assert.equal(cycle.status, 'passed');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(
      `http://127.0.0.1:3000/projects/${encodeURIComponent(cycle.projectId)}`,
    );
    const iframe = page.locator('iframe[title="游戏预览"]');
    await expect(iframe).toHaveAttribute(
      'src',
      cycle.runs.at(-1).result_summary,
    );
    await iframe.evaluate((element) => element.scrollIntoView());
    const frame = page.frameLocator('iframe[title="游戏预览"]');
    await expect(frame.locator('canvas')).toBeVisible();
    await expect(frame.locator('#unity-loading-bar')).toBeHidden({
      timeout: 120_000,
    });
    // Wait past the Unity splash before capturing the actual scene.
    await page.waitForTimeout(6000);
    await iframe.screenshot({
      path: 'artifacts/real-flow/restarted-preview.png',
    });
    await page.goto(cycle.runs.at(-1).result_summary);
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.locator('#unity-loading-bar')).toBeHidden({
      timeout: 120_000,
    });
    await page.waitForTimeout(6000);
    await page.locator('canvas').click();
    await page.keyboard.press('Space');
    await page
      .locator('canvas')
      .screenshot({ path: 'artifacts/real-flow/game-scene.png' });
    assert.deepEqual(errors, []);
    const result = {
      status: 'passed',
      projectId: cycle.projectId,
      backendRestartRecovery: true,
      embeddedWebGL: true,
      standaloneWebGL: true,
      browserErrors: errors,
    };
    await writeFile(
      'artifacts/real-flow/restart-check.json',
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { PostgresDomainRepository } from '../packages/domain/src/repositories/postgres';
import { loadEnvironmentFile } from './dev-env';

loadEnvironmentFile();
async function main() {
  const cycle = JSON.parse(
    await readFile('artifacts/guided-flow/cycle.json', 'utf8'),
  );
  assert.equal(cycle.run.status, 'succeeded');
  const repository = PostgresDomainRepository.fromEnvironment();
  try {
    const result = await repository.pool.query(
      'SELECT s.spec_json, p.current_spec_version_id, d.document FROM projects p JOIN game_spec_versions s ON s.id=p.current_spec_version_id JOIN project_designs d ON d.project_id=p.id WHERE p.id=$1',
      [cycle.projectId],
    );
    assert.deepEqual(result.rows[0]?.spec_json, cycle.reviewed);
    assert.equal(
      (result.rows[0]?.document as { confirmedRunId: string } | undefined)
        ?.confirmedRunId,
      cycle.run.id,
    );
  } finally {
    await repository.close();
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:3000/projects/${cycle.projectId}`);
    await expect(
      page.getByText(
        '我是小白，想做一个轻松的猫咪森林跑酷。先告诉我怎么玩，帮我一起敲定方案。',
        { exact: true },
      ),
    ).toBeVisible();
    await page.screenshot({
      path: 'artifacts/guided-flow/workbench.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: '角色与素材' }).click();
    const uploaded = page.getByRole('img', {
      name: '验收素材-围巾橘猫.png',
      exact: true,
    });
    if (await uploaded.count())
      await expect
        .poll(() =>
          uploaded.evaluate((img) => (img as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
    for (const name of ['围巾橘猫', '晨光森林', '星星金币', '森林木桩'])
      await expect
        .poll(() =>
          page
            .getByRole('img', { name, exact: true })
            .evaluate((img) => (img as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
    await page.screenshot({
      path: 'artifacts/guided-flow/materials.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: '试玩游戏' }).click();
    const iframe = page.locator('iframe[title="游戏预览"]');
    await expect(iframe).toHaveAttribute('src', cycle.run.result_summary);
    await iframe.evaluate((element) => element.scrollIntoView());
    const frame = page.frameLocator('iframe[title="游戏预览"]');
    await expect(frame.locator('#unity-loading-bar')).toBeHidden({
      timeout: 120_000,
    });
    await page.waitForTimeout(6000);
    await iframe.screenshot({
      path: 'artifacts/guided-flow/embedded-tutorial.png',
    });
    await page.setViewportSize({ width: 960, height: 600 });
    await page.goto(cycle.run.result_summary);
    await expect(page.locator('#unity-loading-bar')).toBeHidden({
      timeout: 120_000,
    });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: 'artifacts/guided-flow/game-tutorial.png' });
    await page.locator('canvas').click({ position: { x: 480, y: 386 } });
    await page.waitForTimeout(1000);
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'artifacts/guided-flow/game-playing.png' });
    await page.waitForTimeout(4500);
    await page.screenshot({ path: 'artifacts/guided-flow/game-result.png' });
    assert.deepEqual(errors, []);
    const check = {
      status: 'passed',
      exactReviewedSpecPublished: true,
      conversationRestored: true,
      builtInImagesLoaded: true,
      embeddedWebGLLoaded: true,
      standaloneWebGLLoaded: true,
      browserErrors: errors,
    };
    await writeFile(
      'artifacts/guided-flow/verification.json',
      JSON.stringify(check, null, 2),
    );
    console.log(JSON.stringify(check));
  } finally {
    await browser.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

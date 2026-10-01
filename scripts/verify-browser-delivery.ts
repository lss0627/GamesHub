import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gameCapabilities } from '@gamerhub/game-spec';
import { inspectBrowserBuild } from '../apps/local-dev/src/browser-playtest';

// Reuse actual Unity acceptance artifacts; this never edits or rebuilds a project.
async function main() {
  const root = resolve(
    'unity/Acceptance/GameplayExtensibility/Builds/Web/Presets',
  );
  const output = resolve('artifacts/agent-maturity/browser');
  await mkdir(output, { recursive: true });
  const results = [];
  for (const profile of gameCapabilities.filter((entry) => entry.runtime)) {
    if (process.argv.includes('--broken-only')) break;
    if (!profile.runtime) continue;
    const directory = join(root, profile.genre);
    const hash = createHash('sha256');
    async function visit(folder: string) {
      const entries = await readdir(folder, { withFileTypes: true });
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile()) {
          hash.update(path.slice(directory.length + 1).replaceAll('\\', '/'));
          hash.update(await readFile(path));
        }
      }
    }
    await visit(directory);
    const result = await inspectBrowserBuild({
      root: directory,
      evidenceDirectory: join(output, profile.genre),
      buildHash: `sha256-${hash.digest('hex')}`,
      runId: `acceptance-${profile.genre}`,
      specVersionId: `acceptance-${profile.genre}`,
      runtime: profile.runtime,
      genre: profile.genre,
    });
    results.push({ genre: profile.genre, ...result });
    console.log(
      JSON.stringify({
        genre: profile.genre,
        passed: result.passed,
        code: result.code,
        checks: result.checks,
      }),
    );
  }
  if (results.length)
    await writeFile(
      join(output, 'results.json'),
      JSON.stringify(results, null, 2),
    );
  const brokenRoot = join(output, 'broken-artifact');
  await mkdir(brokenRoot, { recursive: true });
  const brokenHtml =
    '<!doctype html><title>Intentional broken delivery fixture</title><canvas width="960" height="600"></canvas>';
  await writeFile(join(brokenRoot, 'index.html'), brokenHtml);
  const broken = await inspectBrowserBuild({
    root: brokenRoot,
    evidenceDirectory: join(output, 'broken'),
    buildHash: `sha256-${createHash('sha256').update(brokenHtml).digest('hex')}`,
    runId: 'broken-acceptance',
    specVersionId: 'broken-spec',
    runtime: 'clicker-v1',
    genre: 'clicker',
    loadTimeoutMs: 1500,
  });
  await writeFile(
    join(output, 'broken-result.json'),
    JSON.stringify(broken, null, 2),
  );
  console.log(
    JSON.stringify({
      intentionallyBroken: true,
      rejected: !broken.passed,
      code: broken.code,
    }),
  );
  if (broken.passed || broken.code !== 'BROWSER_TELEMETRY_MISSING')
    process.exitCode = 1;
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

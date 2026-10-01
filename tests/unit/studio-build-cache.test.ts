import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  prepareStudioBuild,
  studioBuildFingerprint,
} from '../../scripts/studio-build-cache';

const directories: string[] = [];
const write = (root: string, path: string, value = '{}') => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value);
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gamerhub-build-cache-'));
  directories.push(root);
  for (const path of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    'tsconfig.base.json',
    'apps/studio-web/package.json',
    'apps/studio-web/next.config.ts',
    'apps/studio-web/tsconfig.json',
    'apps/studio-web/src/app/page.tsx',
    'apps/studio-web/public/favicon.svg',
    'apps/studio-web/node_modules/next/package.json',
    'apps/studio-web/node_modules/next/dist/bin/next',
    'apps/studio-web/node_modules/react/package.json',
    'apps/studio-web/node_modules/react-dom/package.json',
    'packages/contracts/src/index.ts',
  ])
    write(root, path);
  const build = vi.fn(async () => {
    const output = join(root, 'apps/studio-web/.next');
    for (const path of [
      'required-server-files.json',
      'build-manifest.json',
      'routes-manifest.json',
      'prerender-manifest.json',
      'server/app-paths-manifest.json',
      'server/pages-manifest.json',
      'server/app/api/studio-health/route.js',
      'static/chunks/main.js',
    ])
      write(output, path);
    write(
      output,
      'required-server-files.json',
      JSON.stringify({
        files: [
          '.next/BUILD_ID',
          '.next/build-manifest.json',
          '.next/server/app-paths-manifest.json',
        ],
      }),
    );
    write(output, 'BUILD_ID', 'production-build');
  });
  return {
    root,
    build,
    stamp: join(root, 'artifacts/dev-tools/studio-build.json'),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('production studio build reuse', () => {
  it('reuses successful unchanged output while ignoring Next cache churn', async () => {
    const { root, build } = fixture();
    expect(await prepareStudioBuild(root, {}, build)).toBe('built');
    write(root, 'apps/studio-web/.next/cache/transient', 'cache churn');
    expect(await prepareStudioBuild(root, {}, build)).toBe('reused');
    expect(build).toHaveBeenCalledTimes(1);
  });
  it.each([
    'apps/studio-web/src/app/page.tsx',
    'apps/studio-web/next.config.ts',
    'apps/studio-web/public/favicon.svg',
    'packages/contracts/src/index.ts',
    'pnpm-lock.yaml',
    'tsconfig.base.json',
    'apps/studio-web/node_modules/next/package.json',
  ])('rebuilds when %s changes', async (path) => {
    const { root, build } = fixture();
    await prepareStudioBuild(root, {}, build);
    write(root, path, 'changed');
    expect(await prepareStudioBuild(root, {}, build)).toBe('built');
    expect(build).toHaveBeenCalledTimes(2);
  });
  it.each([
    { GAMERHUB_API_URL: 'http://127.0.0.1:4001' },
    { NEXT_PUBLIC_SAMPLE: 'updated' },
  ])('rebuilds for changed build environment %j', async (environment) => {
    const { root, build } = fixture();
    await prepareStudioBuild(root, {}, build);
    expect(await prepareStudioBuild(root, environment, build)).toBe('built');
    expect(build).toHaveBeenCalledTimes(2);
  });
  it('detects dotenv changes while persisting no configuration or secret values', async () => {
    const { root, build, stamp } = fixture();
    await prepareStudioBuild(root, {}, build);
    write(root, '.env.local', 'OPENAI_API_KEY=private-build-secret');
    await prepareStudioBuild(
      root,
      { NEXT_PUBLIC_SAMPLE: 'public-value' },
      build,
    );
    expect(build).toHaveBeenCalledTimes(2);
    const cached = readFileSync(stamp, 'utf8');
    expect(cached).not.toMatch(
      /private-build-secret|OPENAI_API_KEY|public-value/,
    );
  });
  it.each([
    'BUILD_ID',
    'server/app/api/studio-health/route.js',
    'static/chunks/main.js',
  ])('rebuilds when output %s is missing', async (path) => {
    const { root, build } = fixture();
    await prepareStudioBuild(root, {}, build);
    rmSync(join(root, 'apps/studio-web/.next', path));
    expect(await prepareStudioBuild(root, {}, build)).toBe('built');
    expect(build).toHaveBeenCalledTimes(2);
  });
  it('refuses reuse and caching when required inputs are missing', async () => {
    const { root, build, stamp } = fixture();
    await prepareStudioBuild(root, {}, build);
    rmSync(join(root, 'pnpm-lock.yaml'));
    expect(studioBuildFingerprint(root, {})).toBeUndefined();
    expect(await prepareStudioBuild(root, {}, build)).toBe('built');
    expect(existsSync(stamp)).toBe(false);
  });
  it('invalidates the previous cache before a failed build and retries next time', async () => {
    const { root, build, stamp } = fixture();
    await prepareStudioBuild(root, {}, build);
    write(root, 'apps/studio-web/src/app/page.tsx', 'changed');
    build.mockRejectedValueOnce(new Error('failed build'));
    await expect(prepareStudioBuild(root, {}, build)).rejects.toThrow(
      'failed build',
    );
    expect(existsSync(stamp)).toBe(false);
    expect(await prepareStudioBuild(root, {}, build)).toBe('built');
    expect(build).toHaveBeenCalledTimes(3);
  });
  it('does not stamp incomplete output or inputs changed during the build', async () => {
    const { root, build, stamp } = fixture();
    await expect(prepareStudioBuild(root, {}, async () => {})).rejects.toThrow(
      '缺少完整输出',
    );
    expect(existsSync(stamp)).toBe(false);
    await prepareStudioBuild(root, {}, async () => {
      await build();
      write(root, 'apps/studio-web/src/app/page.tsx', 'edited during build');
    });
    expect(existsSync(stamp)).toBe(false);
  });
});

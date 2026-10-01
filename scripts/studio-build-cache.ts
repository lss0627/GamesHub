import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const inputExclusions = new Set([
  '.next',
  'node_modules',
  'dist',
  'next-env.d.ts',
]);

function hashFiles(root: string, paths: string[], inputs: boolean) {
  const hash = createHash('sha256');
  const visit = (path: string) => {
    const absolute = join(root, path);
    const entries = readdirSync(absolute, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name, 'en'),
    );
    for (const entry of entries) {
      if (
        inputs &&
        (inputExclusions.has(entry.name) || entry.name.endsWith('.tsbuildinfo'))
      )
        continue;
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) add(child);
      else throw new Error('Unsupported build input.');
    }
  };
  const add = (path: string) => {
    const contents = readFileSync(join(root, path));
    hash.update(`${path}\0${contents.length}\0`).update(contents);
  };
  for (const path of [...paths].sort()) {
    if (statSync(join(root, path)).isDirectory()) visit(path);
    else add(path);
  }
  return hash.digest('hex');
}

/** Only digests are persisted; configuration contents and credentials stay local. */
export function studioBuildFingerprint(
  root: string,
  environment: NodeJS.ProcessEnv,
): string | undefined {
  try {
    const rootInputs = [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.json',
      'tsconfig.base.json',
    ];
    const runtimeInputs = [
      'apps/studio-web/node_modules/next/package.json',
      'apps/studio-web/node_modules/next/dist/bin/next',
      'apps/studio-web/node_modules/react/package.json',
      'apps/studio-web/node_modules/react-dom/package.json',
    ];
    const required = [
      ...rootInputs,
      ...runtimeInputs,
      'apps/studio-web/package.json',
      'apps/studio-web/next.config.ts',
      'apps/studio-web/tsconfig.json',
      'apps/studio-web/src',
      'apps/studio-web/public',
      'packages',
    ];
    if (required.some((path) => !existsSync(join(root, path))))
      return undefined;
    const paths = [
      ...rootInputs,
      ...runtimeInputs,
      'apps/studio-web',
      'packages',
    ];
    for (const path of [
      '.env',
      '.env.local',
      '.env.production',
      '.env.production.local',
      '.npmrc',
      '.pnpmfile.cjs',
      'node_modules/.modules.yaml',
    ]) {
      if (existsSync(join(root, path))) paths.push(path);
    }
    const publicInputs = Object.entries(environment)
      .filter(
        ([key, value]) => key.startsWith('NEXT_PUBLIC_') && value !== undefined,
      )
      .sort(([a], [b]) => a.localeCompare(b, 'en'));
    return createHash('sha256')
      .update(hashFiles(root, paths, true))
      .update(
        JSON.stringify({
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          production: true,
          apiOrigin: environment.GAMERHUB_API_URL ?? 'http://127.0.0.1:3001',
          publicInputs,
        }),
      )
      .digest('hex');
  } catch {
    // Missing, unreadable or unusual inputs always require a fresh build.
    return undefined;
  }
}

function studioOutputFingerprint(root: string): string | undefined {
  try {
    const output = join(root, 'apps/studio-web/.next');
    if (!readFileSync(join(output, 'BUILD_ID'), 'utf8').trim())
      return undefined;
    const manifests = [
      'required-server-files.json',
      'build-manifest.json',
      'routes-manifest.json',
      'prerender-manifest.json',
      'server/app-paths-manifest.json',
      'server/pages-manifest.json',
    ];
    for (const path of manifests) {
      const manifest = JSON.parse(readFileSync(join(output, path), 'utf8'));
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
        return undefined;
    }
    const requiredFiles = JSON.parse(
      readFileSync(join(output, 'required-server-files.json'), 'utf8'),
    ).files as unknown;
    if (!Array.isArray(requiredFiles) || requiredFiles.length === 0)
      return undefined;
    const outputPaths = new Set([
      'BUILD_ID',
      ...manifests.slice(0, 4),
      'server',
      'static',
    ]);
    for (const required of requiredFiles) {
      if (typeof required !== 'string') return undefined;
      const path = required.replaceAll('\\', '/');
      if (!path.startsWith('.next/') || path.split('/').includes('..'))
        return undefined;
      const relative = path.slice('.next/'.length);
      if (!statSync(join(output, relative)).isFile()) return undefined;
      if (!relative.startsWith('server/') && !relative.startsWith('static/'))
        outputPaths.add(relative);
    }
    if (
      !statSync(
        join(output, 'server/app/api/studio-health/route.js'),
      ).isFile() ||
      readdirSync(join(output, 'static')).length === 0
    )
      return undefined;
    return hashFiles(output, [...outputPaths], false);
  } catch {
    return undefined;
  }
}

export async function prepareStudioBuild(
  root: string,
  environment: NodeJS.ProcessEnv,
  build: () => Promise<void>,
): Promise<'built' | 'reused'> {
  const directory = join(root, 'artifacts/dev-tools');
  const stamp = join(directory, 'studio-build.json');
  const inputs = studioBuildFingerprint(root, environment);
  if (inputs) {
    try {
      const previous = JSON.parse(readFileSync(stamp, 'utf8'));
      const output = studioOutputFingerprint(root);
      if (
        previous.version === 1 &&
        previous.inputs === inputs &&
        output &&
        previous.output === output
      )
        return 'reused';
    } catch {
      // A missing or corrupt cache is equivalent to the first launch.
    }
  }
  // Invalidate before building: a failed or interrupted rebuild cannot be reused.
  rmSync(stamp, { force: true });
  await build();
  const output = studioOutputFingerprint(root);
  if (!output)
    throw new Error('创作页面构建缺少完整输出，请检查构建提示后重新启动。');
  if (inputs && inputs === studioBuildFingerprint(root, environment)) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(stamp, JSON.stringify({ version: 1, inputs, output }));
  }
  return 'built';
}

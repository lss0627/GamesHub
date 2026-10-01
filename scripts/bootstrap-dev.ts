import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseEnvironmentFile } from './dev-env';

const projectRoot = resolve(process.cwd());
const environmentPath = join(projectRoot, '.env.local');
const existingContent = existsSync(environmentPath)
  ? readFileSync(environmentPath, 'utf8')
  : undefined;
const existingValues = existingContent
  ? parseEnvironmentFile(existingContent)
  : {};
const unityVersion = '6000.0.80f1';
const defaultEditorPath = `C:\\Program Files\\Unity\\Hub\\Editor\\${unityVersion}\\Editor\\Unity.exe`;
const userEditorPath = join(
  process.env.LOCALAPPDATA ??
    join(process.env.USERPROFILE ?? projectRoot, 'AppData', 'Local'),
  'Programs',
  'Unity',
  'Hub',
  'Editor',
  unityVersion,
  'Editor',
  'Unity.exe',
);
const editorPath = [
  process.env.UNITY_EDITOR_PATH,
  existingValues.UNITY_EDITOR_PATH,
  defaultEditorPath,
  userEditorPath,
].find((candidate) => candidate && existsSync(candidate));
const webModulePath = editorPath
  ? join(dirname(editorPath), 'Data', 'PlaybackEngines', 'WebGLSupport')
  : undefined;
const browserPath =
  process.env.PLAYWRIGHT_BROWSERS_PATH ??
  existingValues.PLAYWRIGHT_BROWSERS_PATH ??
  join(
    process.env.LOCALAPPDATA ??
      join(process.env.USERPROFILE ?? projectRoot, 'AppData', 'Local'),
    'ms-playwright',
  );

const values: Record<string, string> = {
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  STUDIO_PORT: '3000',
  API_PORT: '3001',
  LOCAL_SUPPORT_PORT: '3010',
  GAMERHUB_LOCAL_DEV: '1',
  GAMERHUB_API_URL: 'http://127.0.0.1:3001',
  GAMERHUB_E2E_URL: 'http://127.0.0.1:3000',
  DATABASE_URL: 'postgresql://gamerhub:gamerhub_local@127.0.0.1:5432/gamerhub',
  REDIS_URL: 'redis://127.0.0.1:6379',
  OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
  OBJECT_STORAGE_REGION: 'us-east-1',
  OBJECT_STORAGE_BUCKET: 'gamerhub-local',
  OBJECT_STORAGE_ACCESS_KEY_REF: 'secret://local-dev/object-storage/access-key',
  OBJECT_STORAGE_SECRET_KEY_REF: 'secret://local-dev/object-storage/secret-key',
  OBJECT_STORAGE_ACCESS_KEY: 'gamerhub_local',
  OBJECT_STORAGE_SECRET_KEY: 'gamerhub_local_password',
  GAMERHUB_LOCAL_DATA_MODE: 'postgres-redis',
  GAMERHUB_LOCAL_USER_ID: '00000000-0000-4000-8000-000000000001',
  GAMERHUB_API_USER_ID: '00000000-0000-4000-8000-000000000001',
  ASSET_SCANNER_ENDPOINT: 'http://127.0.0.1:3010',
  ASSET_DECODER_ENDPOINT: 'http://127.0.0.1:3010',
  ASSET_SCANNER_API_KEY: 'local-development-only',
  ASSET_DECODER_API_KEY: 'local-development-only',
  PLAYTEST_PROBE_ENDPOINT: 'http://127.0.0.1:3010',
  EVALUATOR_ENDPOINT: 'http://127.0.0.1:3010/evaluate',
  PREVIEW_PUBLISHER_ENDPOINT: 'http://127.0.0.1:3010/publish',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
  MODEL_PROVIDER_ID: 'deepseek',
  MODEL_PROVIDER_ENDPOINT: 'https://api.deepseek.com',
  MODEL_PROVIDER_MODEL_ID: 'deepseek-v4-pro',
  MODEL_CONTEXT_WINDOW: '1000000',
  MODEL_MAX_OUTPUT_TOKENS: '16384',
  MODEL_REQUEST_TIMEOUT_MS: '120000',
  MODEL_API_KEY_REF: 'secret://env/DEEPSEEK_API_KEY',
  DEEPSEEK_API_KEY: '',
  UNITY_EDITOR_VERSION: unityVersion,
  UNITY_CLI_VERSION: '0.1.0',
  UNITY_PIPELINE_VERSION: '1.0.0',
  UNITY_LICENSE_REF: 'secret://local-dev/unconfigured-unity-license',
  UNITY_EDITOR_PATH: editorPath ?? '',
  UNITY_GOLDEN_PROJECT: join(projectRoot, 'unity', 'Templates', 'Runner'),
  UNITY_WEB_MODULE_READY:
    webModulePath && existsSync(webModulePath) ? '1' : '0',
  PLAYWRIGHT_BROWSERS_PATH: browserPath,
  GAMERHUB_PACKAGE_LOCK_PATH: join(projectRoot, 'pnpm-lock.yaml'),
  GAMERHUB_WORKER_POLL_MS: '250',
  MAX_FIX_ITERATIONS: '5',
  SANDBOX_NETWORK_MODE: 'deny',
};

async function main(): Promise<void> {
  if (existingContent !== undefined) {
    const managedValues: Record<string, string | undefined> = {
      MODEL_PROVIDER_ID:
        existingValues.MODEL_PROVIDER_ID === undefined
          ? values.MODEL_PROVIDER_ID
          : undefined,
      MODEL_PROVIDER_ENDPOINT:
        existingValues.MODEL_PROVIDER_ENDPOINT === undefined
          ? values.MODEL_PROVIDER_ENDPOINT
          : undefined,
      MODEL_PROVIDER_MODEL_ID:
        existingValues.MODEL_PROVIDER_MODEL_ID === undefined
          ? values.MODEL_PROVIDER_MODEL_ID
          : undefined,
      MODEL_CONTEXT_WINDOW:
        existingValues.MODEL_CONTEXT_WINDOW === undefined
          ? values.MODEL_CONTEXT_WINDOW
          : undefined,
      MODEL_MAX_OUTPUT_TOKENS:
        existingValues.MODEL_MAX_OUTPUT_TOKENS === undefined
          ? values.MODEL_MAX_OUTPUT_TOKENS
          : undefined,
      MODEL_REQUEST_TIMEOUT_MS:
        existingValues.MODEL_REQUEST_TIMEOUT_MS === undefined
          ? values.MODEL_REQUEST_TIMEOUT_MS
          : undefined,
      MODEL_API_KEY_REF:
        existingValues.MODEL_API_KEY_REF === undefined
          ? values.MODEL_API_KEY_REF
          : undefined,
      DEEPSEEK_API_KEY:
        existingValues.DEEPSEEK_API_KEY === undefined
          ? values.DEEPSEEK_API_KEY
          : undefined,
      PLAYWRIGHT_BROWSERS_PATH: browserPath,
      UNITY_EDITOR_PATH: editorPath,
      UNITY_WEB_MODULE_READY: editorPath
        ? values.UNITY_WEB_MODULE_READY
        : undefined,
    };
    let updatedContent = existingContent;
    for (const [name, value] of Object.entries(managedValues)) {
      if (value === undefined) continue;
      const line = `${name}=${value}`;
      const linePattern = new RegExp(`^${name}=.*$`, 'm');
      updatedContent = linePattern.test(updatedContent)
        ? updatedContent.replace(linePattern, line)
        : `${updatedContent.trimEnd()}\n${line}\n`;
    }
    const updated = updatedContent !== existingContent;
    if (updated)
      await writeFile(environmentPath, updatedContent, { encoding: 'utf8' });
    console.log(
      JSON.stringify({
        status: updated ? 'updated' : 'preserved',
        path: environmentPath,
        message:
          'Existing values were preserved; only detected tool paths/readiness were refreshed.',
        unityDetected: Boolean(editorPath),
        webModuleDetected: values.UNITY_WEB_MODULE_READY === '1',
        playwrightPath: browserPath,
      }),
    );
    return;
  }
  const content = [
    '# Generated by pnpm dev:bootstrap. Local-only values; never commit this file.',
    '# fixture-local-dev endpoints are not valid release evidence.',
    ...Object.entries(values).map(([name, value]) => `${name}=${value}`),
    '',
  ].join('\n');
  await writeFile(environmentPath, content, { encoding: 'utf8', flag: 'wx' });
  console.log(
    JSON.stringify({
      status: 'created',
      path: environmentPath,
      unityDetected: Boolean(editorPath),
      webModuleDetected: values.UNITY_WEB_MODULE_READY === '1',
      playwrightPath: browserPath,
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadEnvironmentFile } from './dev-env';

loadEnvironmentFile();

const profile =
  process.argv.includes('--profile=local') ||
  (process.argv.includes('--profile') && process.argv.includes('local'))
    ? 'local'
    : 'production';
const nodeReady = Number(process.versions.node.split('.')[0]) >= 24;
const dependencyReady = existsSync('node_modules');
const pnpmResult =
  process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'pnpm.cmd --version'], {
        encoding: 'utf8',
        windowsHide: true,
      })
    : spawnSync('pnpm', ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
      });
const pnpmVersion = pnpmResult.status === 0 ? pnpmResult.stdout.trim() : '';
const pnpmReady = pnpmVersion === '11.19.0';
const dockerResult = spawnSync(
  'docker',
  ['info', '--format', '{{.ServerVersion}}'],
  {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  },
);
const dockerReady =
  dockerResult.status === 0 && dockerResult.stdout.trim().length > 0;
const unityEditorPath = process.env.UNITY_EDITOR_PATH;
const unityCliReady = Boolean(unityEditorPath && existsSync(unityEditorPath));
const projectRoot = process.env.UNITY_GOLDEN_PROJECT;
const unityProjectReady = Boolean(
  projectRoot &&
    !projectRoot.startsWith('fixture://') &&
    existsSync(join(projectRoot, 'ProjectSettings', 'ProjectVersion.txt')),
);
const actualWebModuleReady = Boolean(
  unityEditorPath &&
    existsSync(
      join(dirname(unityEditorPath), 'Data', 'PlaybackEngines', 'WebGLSupport'),
    ),
);
const licenseReady = /^secret:\/\/[^\s]+$/.test(
  process.env.UNITY_LICENSE_REF ?? '',
);
const licenseDecisionReady =
  /^signed:\/\/[^\s]+$/.test(process.env.UNITY_LICENSE_DECISION_REF ?? '') &&
  Number.isInteger(Number(process.env.UNITY_LICENSE_APPROVED_CAPACITY)) &&
  Number(process.env.UNITY_LICENSE_APPROVED_CAPACITY) > 0 &&
  Boolean(process.env.UNITY_LICENSE_EXPIRES_AT) &&
  Number.isFinite(Date.parse(process.env.UNITY_LICENSE_EXPIRES_AT ?? '')) &&
  Date.parse(process.env.UNITY_LICENSE_EXPIRES_AT ?? '') > Date.now();
const assetSecurityReady =
  /^https?:\/\//.test(process.env.ASSET_SCANNER_ENDPOINT ?? '') &&
  /^https?:\/\//.test(process.env.ASSET_DECODER_ENDPOINT ?? '');
const browserRoot = process.env.PLAYWRIGHT_BROWSERS_PATH;
const browserEntries =
  browserRoot && existsSync(browserRoot) ? readdirSync(browserRoot) : [];
const browsersReady = ['chromium', 'firefox', 'webkit'].every((name) =>
  browserEntries.some((entry) => entry.startsWith(`${name}-`)),
);
const localServicesReady = [
  process.env.ASSET_SCANNER_ENDPOINT,
  process.env.ASSET_DECODER_ENDPOINT,
  process.env.PLAYTEST_PROBE_ENDPOINT,
  process.env.EVALUATOR_ENDPOINT,
  process.env.PREVIEW_PUBLISHER_ENDPOINT,
].every((value) => /^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(value ?? ''));
const configuredLocalExecutionMode =
  process.env.GAMERHUB_LOCAL_EXECUTION_MODE ?? 'fixture';
const localExecutionModeReady = ['fixture', 'real-unity'].includes(
  configuredLocalExecutionMode,
);
const configuredLocalDataMode =
  process.env.GAMERHUB_LOCAL_DATA_MODE ??
  (configuredLocalExecutionMode === 'real-unity' ? 'json' : 'memory');
const localDataModeReady = ['memory', 'json', 'postgres-redis'].includes(
  configuredLocalDataMode,
);
const durableLocalData = configuredLocalDataMode === 'postgres-redis';
const redisConfigured = /^rediss?:\/\//.test(process.env.REDIS_URL ?? '');
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const localUserReady = uuidPattern.test(
  process.env.GAMERHUB_LOCAL_USER_ID ?? '',
);
const apiUserReady = uuidPattern.test(process.env.GAMERHUB_API_USER_ID ?? '');
const deepseekRequested = process.env.MODEL_PROVIDER_ID === 'deepseek';
const modelProviderReady =
  process.env.MODEL_PROVIDER_ID === 'local-fixture' ||
  (deepseekRequested &&
    /^https:\/\//.test(process.env.MODEL_PROVIDER_ENDPOINT ?? '') &&
    ['deepseek-v4-flash', 'deepseek-v4-pro'].includes(
      process.env.MODEL_PROVIDER_MODEL_ID ?? '',
    ) &&
    process.env.MODEL_API_KEY_REF === 'secret://env/DEEPSEEK_API_KEY');
const modelApiKeyReady =
  !deepseekRequested || Boolean(process.env.DEEPSEEK_API_KEY?.trim());
const checks = {
  profile,
  node: nodeReady ? process.versions.node : 'requires Node.js 24+',
  pnpm: pnpmReady
    ? pnpmVersion
    : `requires 11.19.0 (found ${pnpmVersion || 'none'})`,
  dependencies: dependencyReady ? 'installed' : 'missing node_modules',
  docker: dockerReady
    ? `ready (${dockerResult.stdout.trim()})`
    : 'Docker Engine unavailable; start Docker Desktop and verify BIOS virtualization',
  database: process.env.DATABASE_URL ? 'configured' : 'missing DATABASE_URL',
  redis: redisConfigured
    ? 'configured as non-authoritative worker wakeup'
    : 'missing or invalid REDIS_URL',
  objectStorage:
    process.env.OBJECT_STORAGE_ENDPOINT && process.env.OBJECT_STORAGE_BUCKET
      ? 'configured'
      : 'missing object-storage settings',
  assetSecurityServices: assetSecurityReady
    ? 'configured'
    : 'missing ASSET_SCANNER_ENDPOINT or ASSET_DECODER_ENDPOINT',
  localServices: localServicesReady
    ? `configured (${configuredLocalExecutionMode}-local-dev)`
    : 'missing loopback local support endpoints',
  localExecutionMode: localExecutionModeReady
    ? configuredLocalExecutionMode
    : 'invalid GAMERHUB_LOCAL_EXECUTION_MODE',
  localDataMode: localDataModeReady
    ? configuredLocalDataMode
    : 'invalid GAMERHUB_LOCAL_DATA_MODE',
  localUser: localUserReady
    ? 'configured UUID (value hidden)'
    : 'missing or invalid GAMERHUB_LOCAL_USER_ID',
  apiUser: apiUserReady
    ? 'configured UUID (value hidden)'
    : 'missing or invalid GAMERHUB_API_USER_ID',
  modelProvider: modelProviderReady
    ? `${process.env.MODEL_PROVIDER_ID} configured`
    : 'missing or invalid model provider configuration',
  modelApiKey: modelApiKeyReady
    ? deepseekRequested
      ? 'configured (value hidden)'
      : 'not required for local fixture'
    : 'missing DEEPSEEK_API_KEY',
  unityCli: unityCliReady ? 'configured' : 'missing UNITY_EDITOR_PATH',
  unityProject: unityProjectReady
    ? 'configured'
    : 'missing licensed Unity project',
  unityVersion: '6000.0.80f1 (pinned in template)',
  webModule:
    process.env.UNITY_WEB_MODULE_READY === '1' && actualWebModuleReady
      ? 'ready'
      : 'missing or not detected on disk',
  license: licenseReady ? 'secret-reference-configured' : 'missing',
  licenseDecision: licenseDecisionReady
    ? 'signed-decision-configured'
    : 'missing signed decision/capacity/expiry',
  browsers: browsersReady
    ? 'chromium/firefox/webkit installed'
    : 'missing Playwright Chromium, Firefox, or WebKit',
  workspaceRepo: process.env.GAMERHUB_WORKSPACE_REPO_PATH
    ? 'configured'
    : 'missing GAMERHUB_WORKSPACE_REPO_PATH',
  unityRunWorkspace: process.env.GAMERHUB_UNITY_PROJECT_PATH_TEMPLATE
    ? 'configured'
    : 'missing GAMERHUB_UNITY_PROJECT_PATH_TEMPLATE',
  playtestProbe: process.env.PLAYTEST_PROBE_ENDPOINT
    ? 'configured'
    : 'missing PLAYTEST_PROBE_ENDPOINT',
  evaluator: process.env.EVALUATOR_ENDPOINT
    ? 'configured'
    : 'missing EVALUATOR_ENDPOINT',
  previewPublisher: process.env.PREVIEW_PUBLISHER_ENDPOINT
    ? 'configured'
    : 'missing PREVIEW_PUBLISHER_ENDPOINT',
};
const commonRequiredChecks = {
  node: nodeReady,
  pnpm: pnpmReady,
  dependencies: dependencyReady,
  docker: dockerReady,
  unityCli: unityCliReady,
  unityProject: unityProjectReady,
  webModule: process.env.UNITY_WEB_MODULE_READY === '1' && actualWebModuleReady,
  browsers: browsersReady,
  modelProvider: modelProviderReady,
  modelApiKey: modelApiKeyReady,
};
const productionRequiredChecks = {
  ...commonRequiredChecks,
  database: Boolean(process.env.DATABASE_URL),
  redis: redisConfigured,
  apiUser: apiUserReady,
  objectStorage: Boolean(
    process.env.OBJECT_STORAGE_ENDPOINT && process.env.OBJECT_STORAGE_BUCKET,
  ),
  assetSecurityServices: assetSecurityReady,
  license: licenseReady,
  licenseDecision: licenseDecisionReady,
  workspaceRepo: Boolean(process.env.GAMERHUB_WORKSPACE_REPO_PATH),
  unityRunWorkspace: Boolean(process.env.GAMERHUB_UNITY_PROJECT_PATH_TEMPLATE),
  playtestProbe: Boolean(process.env.PLAYTEST_PROBE_ENDPOINT),
  evaluator: Boolean(process.env.EVALUATOR_ENDPOINT),
  previewPublisher: Boolean(process.env.PREVIEW_PUBLISHER_ENDPOINT),
  deepseekProvider: deepseekRequested && modelProviderReady && modelApiKeyReady,
};
const localRequiredChecks = {
  ...commonRequiredChecks,
  localServices: localServicesReady,
  localExecutionMode: localExecutionModeReady,
  localDataMode: localDataModeReady,
  ...(durableLocalData
    ? {
        database: Boolean(process.env.DATABASE_URL),
        redis: redisConfigured,
        localUser: localUserReady,
        objectStorage: Boolean(
          process.env.OBJECT_STORAGE_ENDPOINT &&
            process.env.OBJECT_STORAGE_BUCKET,
        ),
      }
    : {}),
};
const requiredChecks =
  profile === 'local' ? localRequiredChecks : productionRequiredChecks;
const blockingChecks = Object.entries(requiredChecks)
  .filter(([, ready]) => !ready)
  .map(([name]) => name);
const status = blockingChecks.length === 0 ? 'ready' : 'blocked';
console.log(
  JSON.stringify({
    profile,
    status,
    requiredChecks: Object.keys(requiredChecks),
    blockingChecks,
    checks,
  }),
);
if (status !== 'ready') process.exitCode = 1;

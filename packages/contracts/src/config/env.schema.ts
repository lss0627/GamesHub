import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  STUDIO_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOCAL_SUPPORT_PORT: z.coerce.number().int().min(1).max(65535).default(3010),
  GAMERHUB_LOCAL_DEV: z.enum(['0', '1']).default('0'),
  GAMERHUB_API_URL: z.string().url().optional(),
  GAMERHUB_E2E_URL: z.string().url().optional(),
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgresql://')),
  OBJECT_STORAGE_ENDPOINT: z.string().url(),
  OBJECT_STORAGE_REGION: z.string().min(1),
  OBJECT_STORAGE_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  OBJECT_STORAGE_ACCESS_KEY_REF: z.string().startsWith('secret://'),
  OBJECT_STORAGE_SECRET_KEY_REF: z.string().startsWith('secret://'),
  OBJECT_STORAGE_ACCESS_KEY: z.string().min(1).optional(),
  OBJECT_STORAGE_SECRET_KEY: z.string().min(1).optional(),
  ASSET_SCANNER_ENDPOINT: z.string().url().optional(),
  ASSET_DECODER_ENDPOINT: z.string().url().optional(),
  ASSET_SCANNER_API_KEY: z.string().min(1).optional(),
  ASSET_DECODER_API_KEY: z.string().min(1).optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url(),
  MODEL_PROVIDER_ID: z.enum(['local-fixture', 'deepseek']),
  MODEL_API_KEY_REF: z.string().startsWith('secret://'),
  MODEL_PROVIDER_ENDPOINT: z.string().url().optional(),
  MODEL_PROVIDER_MODEL_ID: z
    .enum(['deepseek-v4-flash', 'deepseek-v4-pro'])
    .optional(),
  MODEL_CONTEXT_WINDOW: z.coerce
    .number()
    .int()
    .min(8_192)
    .max(2_000_000)
    .optional(),
  MODEL_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(256)
    .max(384_000)
    .optional(),
  MODEL_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  UNITY_EDITOR_VERSION: z.literal('6000.0.80f1'),
  UNITY_CLI_VERSION: z.string().min(1),
  UNITY_PIPELINE_VERSION: z.string().min(1),
  UNITY_LICENSE_REF: z.string().startsWith('secret://'),
  UNITY_LICENSE_DECISION_REF: z.string().startsWith('signed://').optional(),
  UNITY_LICENSE_APPROVED_CAPACITY: z.coerce.number().int().min(1).optional(),
  UNITY_LICENSE_EXPIRES_AT: z.string().datetime().optional(),
  UNITY_EDITOR_PATH: z.string().min(1).or(z.literal('')).optional(),
  UNITY_CLI_PATH: z.string().min(1).or(z.literal('')).optional(),
  UNITY_GOLDEN_PROJECT: z.string().min(1).or(z.literal('')).optional(),
  UNITY_WEB_MODULE_READY: z.enum(['0', '1']).default('0'),
  GAMERHUB_WORKSPACE_REPO_PATH: z.string().min(1).optional(),
  GAMERHUB_UNITY_PROJECT_PATH_TEMPLATE: z.string().min(1).optional(),
  GAMERHUB_PACKAGE_LOCK_PATH: z.string().min(1).optional(),
  GAMERHUB_WORKER_POLL_MS: z.coerce.number().int().min(100).optional(),
  PLAYTEST_PROBE_ENDPOINT: z.string().url().optional(),
  EVALUATOR_ENDPOINT: z.string().url().optional(),
  PREVIEW_PUBLISHER_ENDPOINT: z.string().url().optional(),
  PLAYWRIGHT_BROWSERS_PATH: z.string().min(1).or(z.literal('')).optional(),
  MAX_FIX_ITERATIONS: z.coerce.number().int().min(0).max(5).default(5),
  SANDBOX_NETWORK_MODE: z.literal('deny').default('deny'),
});

export type Environment = z.infer<typeof envSchema>;

export interface ProductionUnityLicenseDecision {
  decisionRef: `signed://${string}`;
  approvedCapacity: number;
  expiresAt: string;
}

export function requireProductionUnityLicenseDecision(
  source: Record<string, string | undefined> = process.env,
): ProductionUnityLicenseDecision {
  const decisionRef = source.UNITY_LICENSE_DECISION_REF;
  const capacity = Number(source.UNITY_LICENSE_APPROVED_CAPACITY);
  const expiresAt = source.UNITY_LICENSE_EXPIRES_AT;
  if (!decisionRef?.startsWith('signed://'))
    throw new Error('UNITY_LICENSE_DECISION_REQUIRED');
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new Error('UNITY_LICENSE_CAPACITY_REQUIRED');
  if (
    !expiresAt ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    Date.parse(expiresAt) <= Date.now()
  )
    throw new Error('UNITY_LICENSE_DECISION_EXPIRED');
  return {
    decisionRef: decisionRef as `signed://${string}`,
    approvedCapacity: capacity,
    expiresAt,
  };
}

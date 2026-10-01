import { createConfiguredModelProvider } from '@gamerhub/model-provider';
import { loadEnvironmentFile } from './dev-env';
import { probeDeepSeekBalance } from './model-doctor-lib';

loadEnvironmentFile();

async function main(): Promise<void> {
  const configuration = createConfiguredModelProvider(process.env, {
    allowFixture: false,
  });
  if (configuration.mode !== 'deepseek')
    throw new Error('DEEPSEEK_PROVIDER_REQUIRED');
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY_REQUIRED');
  const [health, models, balance] = await Promise.all([
    configuration.provider.health(),
    configuration.provider.listModels(),
    probeDeepSeekBalance({
      endpoint: configuration.endpoint,
      apiKey,
    }),
  ]);
  const modelAvailable = models.some(
    (model) => model.modelId === configuration.modelId,
  );
  const ready =
    health.status === 'ready' && modelAvailable && balance.available;
  const result = {
    status: ready ? 'ready' : 'blocked',
    providerId: health.providerId,
    modelId: configuration.modelId,
    endpoint: configuration.endpoint,
    metadata: health.status,
    modelAvailable,
    balance: balance.available ? 'available' : 'unavailable',
    ...(balance.reason ? { reason: balance.reason } : {}),
    credential: 'configured (value hidden)',
  };
  console.log(JSON.stringify(result));
  if (!ready) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      status: 'blocked',
      providerId: process.env.MODEL_PROVIDER_ID ?? 'unconfigured',
      reason: message.slice(0, 1000),
      credential: process.env.DEEPSEEK_API_KEY?.trim()
        ? 'configured (value hidden)'
        : 'missing',
    }),
  );
  process.exitCode = 1;
});

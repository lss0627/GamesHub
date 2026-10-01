import { type Environment, envSchema } from './env.schema';

export type SecretRef = `secret://${string}`;

export function parseSecretRef(value: string): SecretRef {
  if (!value.startsWith('secret://') || value.length <= 'secret://'.length)
    throw new Error('SECRET_REF_INVALID');
  return value as SecretRef;
}

export function loadEnvironment(
  source: Record<string, string | undefined> = process.env,
): Environment {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `ENV_INVALID: ${result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
    );
  }
  return result.data;
}

export function secretReferences(environment: Environment): SecretRef[] {
  return [
    parseSecretRef(environment.OBJECT_STORAGE_ACCESS_KEY_REF),
    parseSecretRef(environment.OBJECT_STORAGE_SECRET_KEY_REF),
    parseSecretRef(environment.MODEL_API_KEY_REF),
    parseSecretRef(environment.UNITY_LICENSE_REF),
  ];
}

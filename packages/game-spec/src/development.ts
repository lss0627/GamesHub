import type { GameSpec } from './types';

export interface MechanismDevelopment {
  id: string;
  description: string;
  acceptance: string[];
  operation?: 'implement' | 'retire';
  acceptanceVersion?: 1;
}
export function validateDevelopment(value: unknown): MechanismDevelopment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5)
    throw new Error('DEVELOPMENT_INVALID');
  const seen = new Set<string>();
  return value.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      !/^[a-z][a-z0-9_]{1,40}$/.test(item.id) ||
      seen.has(item.id) ||
      typeof item.description !== 'string' ||
      !item.description.trim() ||
      item.description.length > 600 ||
      (item.operation !== undefined &&
        !['implement', 'retire'].includes(item.operation)) ||
      (item.acceptanceVersion !== undefined && item.acceptanceVersion !== 1) ||
      !Array.isArray(item.acceptance) ||
      item.acceptance.length < 2 ||
      item.acceptance.length > 6 ||
      item.acceptance.some(
        (text: unknown) =>
          typeof text !== 'string' || !text.trim() || text.length > 300,
      )
    )
      throw new Error('DEVELOPMENT_INVALID');
    seen.add(item.id);
    return {
      id: item.id,
      description: item.description,
      acceptance: [...item.acceptance],
      ...(item.operation !== undefined ? { operation: item.operation } : {}),
      ...(item.acceptanceVersion !== undefined
        ? { acceptanceVersion: 1 as const }
        : {}),
    };
  });
}
export function developmentFor(spec: GameSpec): MechanismDevelopment[] {
  return validateDevelopment(spec.extensions?.gamerhub_development);
}

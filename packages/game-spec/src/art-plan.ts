import { parseGameSpec } from '@gamerhub/contracts';
import type { GameSpec } from './types';

export const artRoles = ['cat', 'forest', 'coin', 'stump'] as const;
export type ArtRole = (typeof artRoles)[number];
export interface ArtBinding {
  role: ArtRole;
  assetId: string;
  contentHash: string;
  name: string;
}
export interface ArtCandidate {
  id: string;
  name: string;
  source: 'builtin' | 'image-provider';
  style: string;
  assets: ArtBinding[];
  provenance?: {
    provider: string;
    model?: string;
    createdAt: string;
  };
}
export interface ArtGeneration {
  /** Stable across retries; ArtPlan.generationId identifies each execution. */
  id: string;
  source: ArtCandidate['source'];
  provider: string;
  model?: string;
  fingerprint: string;
  phase: 'planning' | 'images' | 'complete';
  total: 8;
  completed: number;
  requirements: ArtPlan['requirements'];
  styles: string[];
  candidates: ArtCandidate[];
  active?: { style: string; role: ArtRole };
}
export interface ArtPlan {
  revision: number;
  status: 'empty' | 'generating' | 'ready' | 'failed';
  prompt: string;
  requirements: Array<{ role: ArtRole; description: string }>;
  candidates: ArtCandidate[];
  selectedCandidateId?: string;
  generationId?: string;
  generation?: ArtGeneration;
  startedAt?: string;
  errorCode?: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hashPattern = /^sha256-[0-9a-f]{64}$/;
const artStyles = ['day', 'dusk', 'night'];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, max = 200): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= max
  );
}

function artRole(value: unknown): value is ArtRole {
  return typeof value === 'string' && artRoles.includes(value as ArtRole);
}

function generationInvalid(): never {
  throw Object.assign(new Error('ART_GENERATION_INVALID'), {
    code: 'ART_GENERATION_INVALID',
    statusCode: 400,
  });
}

/** Validate persisted progress before it can authorize skipping image requests. */
export function validateArtGeneration(
  value: unknown,
): asserts value is ArtGeneration {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    !uuidPattern.test(value.id) ||
    (value.source !== 'builtin' && value.source !== 'image-provider') ||
    !boundedText(value.provider) ||
    (value.model !== undefined && !boundedText(value.model)) ||
    typeof value.fingerprint !== 'string' ||
    !hashPattern.test(value.fingerprint) ||
    (value.phase !== 'planning' &&
      value.phase !== 'images' &&
      value.phase !== 'complete') ||
    value.total !== 8 ||
    !Number.isInteger(value.completed) ||
    typeof value.completed !== 'number' ||
    value.completed < 0 ||
    value.completed > 8 ||
    !Array.isArray(value.requirements) ||
    !Array.isArray(value.styles) ||
    !Array.isArray(value.candidates)
  )
    generationInvalid();

  if (value.phase === 'planning') {
    if (
      value.completed !== 0 ||
      value.requirements.length !== 0 ||
      value.styles.length !== 0 ||
      value.candidates.length !== 0 ||
      value.active !== undefined
    )
      generationInvalid();
    return;
  }

  const { styles, requirements, candidates } = value;
  if (
    styles.length !== 2 ||
    new Set(styles).size !== 2 ||
    styles.some(
      (style) => typeof style !== 'string' || !artStyles.includes(style),
    ) ||
    requirements.length !== artRoles.length ||
    requirements.some(
      (item) =>
        !record(item) ||
        !artRole(item.role) ||
        !boundedText(item.description, 2000),
    ) ||
    new Set(requirements.map((item) => item.role)).size !== artRoles.length ||
    candidates.length !== 2
  )
    generationInvalid();

  const candidateIds = new Set<string>();
  const assetIds = new Set<string>();
  let completed = 0;
  for (const [index, candidate] of candidates.entries()) {
    if (
      !record(candidate) ||
      typeof candidate.id !== 'string' ||
      !uuidPattern.test(candidate.id) ||
      candidateIds.has(candidate.id.toLowerCase()) ||
      !boundedText(candidate.name) ||
      candidate.style !== styles[index] ||
      candidate.source !== value.source ||
      !Array.isArray(candidate.assets) ||
      candidate.assets.length > artRoles.length
    )
      generationInvalid();
    candidateIds.add(candidate.id.toLowerCase());
    if (candidate.provenance !== undefined) {
      const provenance = candidate.provenance;
      if (
        !record(provenance) ||
        provenance.provider !== value.provider ||
        provenance.model !== value.model ||
        !boundedText(provenance.createdAt, 100) ||
        !Number.isFinite(Date.parse(provenance.createdAt))
      )
        generationInvalid();
    }
    const roles = new Set<ArtRole>();
    for (const binding of candidate.assets) {
      if (
        !record(binding) ||
        !artRole(binding.role) ||
        roles.has(binding.role) ||
        typeof binding.assetId !== 'string' ||
        !uuidPattern.test(binding.assetId) ||
        assetIds.has(binding.assetId.toLowerCase()) ||
        typeof binding.contentHash !== 'string' ||
        !hashPattern.test(binding.contentHash) ||
        !boundedText(binding.name)
      )
        generationInvalid();
      roles.add(binding.role);
      assetIds.add(binding.assetId.toLowerCase());
      completed += 1;
    }
  }
  if (
    completed !== value.completed ||
    (value.phase === 'complete' && completed !== 8)
  )
    generationInvalid();
  if (value.active !== undefined) {
    const active = value.active;
    if (
      value.phase !== 'images' ||
      !record(active) ||
      !styles.includes(active.style) ||
      !artRole(active.role) ||
      candidates.some(
        (candidate) =>
          candidate.style === active.style &&
          candidate.assets.some(
            (binding: ArtBinding) => binding.role === active.role,
          ),
      )
    )
      generationInvalid();
  }
}

export const logicalArtIds: Record<ArtRole, string> = {
  cat: 'cat_player',
  forest: 'forest',
  coin: 'coin',
  stump: 'obstacle',
};
export function validateCandidate(candidate: ArtCandidate): void {
  if (
    !candidate ||
    !Array.isArray(candidate.assets) ||
    candidate.assets.length !== 4 ||
    artRoles.some(
      (role) =>
        candidate.assets.filter((asset) => asset.role === role).length !== 1,
    ) ||
    candidate.assets.some(
      (asset) =>
        !/^[0-9a-f-]{36}$/i.test(asset.assetId) ||
        !/^sha256-[0-9a-f]{64}$/.test(asset.contentHash),
    )
  )
    throw new Error('ART_INCOMPLETE');
}
export function bindCandidate(
  input: GameSpec,
  candidate: ArtCandidate,
): GameSpec {
  validateCandidate(candidate);
  const spec = structuredClone(input);
  const replaced = new Set(Object.values(logicalArtIds));
  spec.assets = spec.assets.filter((asset) => !replaced.has(asset.logical_id));
  spec.assets.push(
    ...candidate.assets.map((asset) => ({
      logical_id: logicalArtIds[asset.role],
      type: 'sprite' as const,
      source: 'upload' as const,
      asset_id: asset.assetId,
    })),
  );
  spec.extensions = {
    ...spec.extensions,
    gamerhub_art: structuredClone(candidate),
  };
  return parseGameSpec(spec);
}
export function specArt(spec?: GameSpec): ArtCandidate | undefined {
  const candidate = spec?.extensions?.gamerhub_art as ArtCandidate | undefined;
  if (candidate) validateCandidate(candidate);
  return candidate;
}

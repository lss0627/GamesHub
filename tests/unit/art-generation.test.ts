import {
  type ArtBinding,
  type ArtGeneration,
  artRoles,
  validateArtGeneration,
} from '@gamerhub/game-spec';
import { describe, expect, it } from 'vitest';

const id = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const binding = (index: number): ArtBinding => ({
  role: artRoles[index % 4],
  assetId: id(index + 10),
  contentHash: `sha256-${'a'.repeat(64)}`,
  name: `素材-${index}.png`,
});
function checkpoint(completed = 1): ArtGeneration {
  return {
    id: id(1),
    source: 'image-provider',
    provider: 'openai',
    model: 'test-image-model',
    fingerprint: `sha256-${'b'.repeat(64)}`,
    phase: 'images',
    total: 8,
    completed,
    requirements: artRoles.map((role) => ({
      role,
      description: `${role}的美术要求`,
    })),
    styles: ['day', 'night'],
    candidates: ['day', 'night'].map((style, index) => ({
      id: id(index + 2),
      name: style,
      style,
      source: 'image-provider',
      assets: Array.from(
        { length: Math.max(0, Math.min(4, completed - index * 4)) },
        (_, role) => binding(index * 4 + role),
      ),
      provenance: {
        provider: 'openai',
        model: 'test-image-model',
        createdAt: '2026-09-26T06:00:00+00:00',
      },
    })),
  };
}

describe('resumable art checkpoints', () => {
  it('accepts empty planning, partial image work and fully committed pairs', () => {
    const planning: ArtGeneration = {
      ...checkpoint(0),
      phase: 'planning',
      requirements: [],
      styles: [],
      candidates: [],
    };
    const images = {
      ...checkpoint(5),
      active: { style: 'night', role: 'forest' as const },
    };
    const complete = { ...checkpoint(8), phase: 'complete' as const };
    for (const value of [
      planning,
      checkpoint(0),
      images,
      checkpoint(8),
      complete,
    ]) {
      expect(() => validateArtGeneration(value)).not.toThrow();
    }
  });

  it('supports builtin checkpoints without model or provenance', () => {
    const value = checkpoint(1);
    value.source = 'builtin';
    value.provider = 'builtin';
    delete value.model;
    for (const candidate of value.candidates) {
      candidate.source = 'builtin';
      delete candidate.provenance;
    }
    expect(() => validateArtGeneration(value)).not.toThrow();
  });

  it.each([
    ['null', () => null],
    ['missing fields', () => ({})],
    [
      'array masquerading as source',
      (value: ArtGeneration) => ({ ...value, source: ['image-provider'] }),
    ],
    [
      'array masquerading as phase',
      (value: ArtGeneration) => ({ ...value, phase: ['images'] }),
    ],
    [
      'malformed UUID',
      (value: ArtGeneration) => ({ ...value, id: '-'.repeat(36) }),
    ],
    [
      'unknown source',
      (value: ArtGeneration) => ({ ...value, source: 'remote-url' }),
    ],
    [
      'unknown phase',
      (value: ArtGeneration) => ({ ...value, phase: 'queued' }),
    ],
    [
      'missing provider',
      (value: ArtGeneration) => ({ ...value, provider: '' }),
    ],
    [
      'oversized model',
      (value: ArtGeneration) => ({ ...value, model: 'a'.repeat(201) }),
    ],
    [
      'malformed fingerprint',
      (value: ArtGeneration) => ({ ...value, fingerprint: 'a'.repeat(64) }),
    ],
    ['wrong total', (value: ArtGeneration) => ({ ...value, total: 9 })],
    [
      'fractional progress',
      (value: ArtGeneration) => ({ ...value, completed: 1.5 }),
    ],
    [
      'inflated progress',
      (value: ArtGeneration) => ({ ...value, completed: 2 }),
    ],
    [
      'negative progress',
      (value: ArtGeneration) => ({ ...value, completed: -1 }),
    ],
    [
      'progress outside total',
      (value: ArtGeneration) => ({ ...value, completed: 9 }),
    ],
    [
      'planning with work',
      (value: ArtGeneration) => ({ ...value, phase: 'planning' }),
    ],
    [
      'premature completion',
      (value: ArtGeneration) => ({ ...value, phase: 'complete' }),
    ],
    [
      'duplicate styles',
      (value: ArtGeneration) => ({ ...value, styles: ['day', 'day'] }),
    ],
    [
      'unsupported style',
      (value: ArtGeneration) => ({ ...value, styles: ['day', 'custom'] }),
    ],
    [
      'missing role requirement',
      (value: ArtGeneration) => ({
        ...value,
        requirements: value.requirements.slice(1),
      }),
    ],
    [
      'duplicate requirement',
      (value: ArtGeneration) => ({
        ...value,
        requirements: Array(4).fill(value.requirements[0]),
      }),
    ],
    [
      'oversized description',
      (value: ArtGeneration) => ({
        ...value,
        requirements: value.requirements.map((item) => ({
          ...item,
          description: 'a'.repeat(2001),
        })),
      }),
    ],
    [
      'null requirement',
      (value: ArtGeneration) => ({
        ...value,
        requirements: [null, ...value.requirements.slice(1)],
      }),
    ],
    [
      'extra candidate',
      (value: ArtGeneration) => ({
        ...value,
        candidates: [...value.candidates, value.candidates[0]],
      }),
    ],
    [
      'null candidate',
      (value: ArtGeneration) => ({
        ...value,
        candidates: [null, value.candidates[1]],
      }),
    ],
    [
      'unknown active style',
      (value: ArtGeneration) => ({
        ...value,
        active: { style: 'dusk', role: 'forest' },
      }),
    ],
    [
      'unknown active role',
      (value: ArtGeneration) => ({
        ...value,
        active: { style: 'day', role: 'extra' },
      }),
    ],
    [
      'committed active slot',
      (value: ArtGeneration) => ({
        ...value,
        active: { style: 'day', role: 'cat' },
      }),
    ],
    [
      'null active slot',
      (value: ArtGeneration) => ({ ...value, active: null }),
    ],
  ])('rejects %s', (_label, mutate) => {
    expect(() => validateArtGeneration(mutate(checkpoint()))).toThrow(
      'ART_GENERATION_INVALID',
    );
  });

  it.each([
    [
      'duplicate candidate id',
      (value: ArtGeneration) => {
        value.candidates[1].id = value.candidates[0].id;
      },
    ],
    [
      'candidate style mismatch',
      (value: ArtGeneration) => {
        value.candidates[0].style = 'night';
      },
    ],
    [
      'candidate source mismatch',
      (value: ArtGeneration) => {
        value.candidates[0].source = 'builtin';
      },
    ],
    [
      'blank candidate name',
      (value: ArtGeneration) => {
        value.candidates[0].name = ' ';
      },
    ],
    [
      'provenance provider mismatch',
      (value: ArtGeneration) => {
        value.candidates[0].provenance.provider = 'other-provider';
      },
    ],
    [
      'provenance model mismatch',
      (value: ArtGeneration) => {
        delete value.candidates[0].provenance.model;
      },
    ],
    [
      'invalid provenance date',
      (value: ArtGeneration) => {
        value.candidates[0].provenance.createdAt = 'invalid';
      },
    ],
    [
      'duplicate role binding',
      (value: ArtGeneration) => {
        value.candidates[0].assets.push({ ...binding(1), role: 'cat' });
        value.completed++;
      },
    ],
    [
      'duplicate asset across styles',
      (value: ArtGeneration) => {
        value.candidates[1].assets.push({
          ...value.candidates[0].assets[0],
        });
        value.completed++;
      },
    ],
    [
      'malformed asset UUID',
      (value: ArtGeneration) => {
        value.candidates[0].assets[0].assetId = '-'.repeat(36);
      },
    ],
    [
      'malformed content hash',
      (value: ArtGeneration) => {
        value.candidates[0].assets[0].contentHash = 'sha256-invalid';
      },
    ],
    [
      'missing asset name',
      (value: ArtGeneration) => {
        value.candidates[0].assets[0].name = '';
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const value = checkpoint();
    mutate(value);
    expect(() => validateArtGeneration(value)).toThrow(
      'ART_GENERATION_INVALID',
    );
  });

  it('rejects active slots during planning or after completion', () => {
    for (const value of [
      {
        ...checkpoint(0),
        phase: 'planning',
        requirements: [],
        styles: [],
        candidates: [],
        active: { style: 'day', role: 'cat' },
      },
      {
        ...checkpoint(8),
        phase: 'complete',
        active: { style: 'night', role: 'stump' },
      },
    ])
      expect(() => validateArtGeneration(value)).toThrow(
        'ART_GENERATION_INVALID',
      );
  });
});

import { describe, expect, it } from 'vitest';
import {
  readArtDraft,
  writeArtDraft,
} from '../../apps/studio-web/src/features/creator/art-draft';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
  };
}

describe('art drafts', () => {
  it('preserves empty input and the selected source separately for each project', () => {
    const storage = memoryStorage();
    writeArtDraft(storage, 'project/a', {
      prompt: '',
      source: 'image-provider',
    });
    writeArtDraft(storage, 'project/b', { prompt: '月色', source: 'builtin' });
    expect(readArtDraft(storage, 'project/a')).toEqual({
      prompt: '',
      source: 'image-provider',
    });
    expect(readArtDraft(storage, 'project/b')).toEqual({
      prompt: '月色',
      source: 'builtin',
    });
    expect(readArtDraft(storage, 'project/c')).toBeUndefined();
  });

  it.each([
    '{',
    'null',
    '{"prompt":1,"source":"builtin"}',
    '{"prompt":"x","source":"other"}',
  ])('ignores damaged drafts: %s', (value) => {
    expect(readArtDraft({ getItem: () => value }, 'project')).toBeUndefined();
  });

  it('bounds saved text and tolerates unavailable browser storage', () => {
    expect(
      readArtDraft(
        {
          getItem: () =>
            JSON.stringify({ prompt: 'x'.repeat(2000), source: 'builtin' }),
        },
        'project',
      )?.prompt,
    ).toHaveLength(1500);
    const unavailable = () => {
      throw new Error('storage blocked');
    };
    expect(readArtDraft({ getItem: unavailable }, 'project')).toBeUndefined();
    expect(() =>
      writeArtDraft({ setItem: unavailable }, 'project', {
        prompt: '月色',
        source: 'builtin',
      }),
    ).not.toThrow();
  });
});

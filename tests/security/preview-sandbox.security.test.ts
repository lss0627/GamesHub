import { expect, it } from 'vitest';
import { previewSandbox } from '../../apps/studio-web/src/features/preview/preview-sandbox';

it('permits Unity storage only on a separate HTTP publisher origin', () => {
  expect(
    previewSandbox('http://127.0.0.1:3010/game', 'http://127.0.0.1:3000'),
  ).toBe('allow-scripts allow-same-origin');
  for (const url of [
    '/game',
    'https://studio.example/game',
    'javascript:alert(1)',
    'data:text/html,test',
    undefined,
  ])
    expect(previewSandbox(url, 'https://studio.example')).toBe('allow-scripts');
  expect(previewSandbox('https://preview.example/game')).toBe('allow-scripts');
});

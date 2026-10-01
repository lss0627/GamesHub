import { describe, expect, it } from 'vitest';
import { parseEnvironmentFile } from '../../scripts/dev-env';

describe('local environment file parser', () => {
  it('loads simple and quoted values while ignoring comments', () => {
    expect(
      parseEnvironmentFile(`
# local configuration
HOST=127.0.0.1
UNITY_EDITOR_PATH="C:\\Program Files\\Unity\\Editor\\Unity.exe"
EMPTY=
INVALID NAME=value
`),
    ).toEqual({
      HOST: '127.0.0.1',
      UNITY_EDITOR_PATH: 'C:\\Program Files\\Unity\\Editor\\Unity.exe',
      EMPTY: '',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { ensureS3Bucket } from '../../packages/assets/src/s3-object-store';

const options = {
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  bucket: 'gamerhub-local',
  accessKeyId: 'local',
  secretAccessKey: 'local-password',
};

describe('local S3 bucket bootstrap', () => {
  it('leaves an existing bucket unchanged', async () => {
    const commands: string[] = [];
    const client = {
      send: async (command: object) => {
        commands.push(command.constructor.name);
        return {};
      },
    };

    await expect(
      ensureS3Bucket({ ...options, client: client as never }),
    ).resolves.toBe('existing');
    expect(commands).toEqual(['HeadBucketCommand']);
  });

  it('creates a missing bucket exactly once', async () => {
    const commands: string[] = [];
    const client = {
      send: async (command: object) => {
        commands.push(command.constructor.name);
        if (command.constructor.name === 'HeadBucketCommand')
          throw new Error('missing');
        return {};
      },
    };

    await expect(
      ensureS3Bucket({ ...options, client: client as never }),
    ).resolves.toBe('created');
    expect(commands).toEqual(['HeadBucketCommand', 'CreateBucketCommand']);
  });
});

import { describe, expect, it } from 'vitest';
import { runtimeSnapshotFromUnknown } from '../../apps/studio-web/src/features/system/RuntimeReadiness';

describe('runtime readiness UI contract', () => {
  it('keeps safe dependency status and runtime metadata', () => {
    expect(
      runtimeSnapshotFromUnknown({
        status: 'ready',
        executionMode: 'real-unity',
        dataPlane: {
          mode: 'postgres-redis',
          authoritativeStore: 'postgresql',
          wakeupTransport: 'redis-pubsub',
          durableFallback: 'postgresql-skip-locked',
          postgres: {
            status: 'ready',
            latencyMs: 4,
            migrationCount: 6,
            requiredMigrationCount: 6,
          },
          redis: { status: 'ready', latencyMs: 2 },
          objectStorage: { status: 'ready', latencyMs: 6 },
        },
        services: {
          agent: {
            status: 'ready',
            runtime: 'pi-agent-core',
            version: '0.85.1',
            privatePath: 'must-not-be-exposed',
          },
          model: { status: 'ready', provider: 'deepseek', model: 'safe-id' },
          unity: { status: 'ready', version: '6000.0.80f1' },
        },
      }),
    ).toMatchObject({
      status: 'ready',
      executionMode: 'real-unity',
      dataPlane: {
        mode: 'postgres-redis',
        postgres: {
          status: 'ready',
          migrationCount: 6,
          requiredMigrationCount: 6,
        },
        redis: { status: 'ready' },
      },
      services: {
        agent: { status: 'ready', runtime: 'pi-agent-core', version: '0.85.1' },
        model: { status: 'ready', provider: 'deepseek' },
        unity: { status: 'ready', version: '6000.0.80f1' },
      },
    });
  });

  it('rejects payloads without a known overall status', () => {
    expect(runtimeSnapshotFromUnknown({ status: 'invented' })).toBeUndefined();
  });

  it('keeps optional image configuration distinct from a verified connection', () => {
    const snapshot = runtimeSnapshotFromUnknown({
      status: 'ready',
      services: {
        images: {
          status: 'ready',
          provider: 'openai',
          model: 'image-model',
          optional: true,
          configurationOnly: true,
          builtinAvailable: true,
          apiKey: 'must-not-be-exposed',
          endpoint: 'https://private.example',
        },
      },
    });
    expect(snapshot?.services?.images).toEqual({
      status: 'ready',
      provider: 'openai',
      model: 'image-model',
      optional: true,
      configurationOnly: true,
      builtinAvailable: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain('must-not-be-exposed');
    expect(JSON.stringify(snapshot)).not.toContain('private.example');
  });

  it.each(['blocked', 'bypassed'])(
    'does not block core creation when optional images are %s',
    (imageStatus) => {
      const snapshot = runtimeSnapshotFromUnknown({
        status: 'ready',
        services: {
          images: {
            status: imageStatus,
            optional: true,
            configurationOnly: true,
            builtinAvailable: true,
          },
        },
      });
      expect(snapshot?.status).toBe('ready');
      expect(snapshot?.services?.images?.status).toBe(imageStatus);
      expect(snapshot?.services?.images?.builtinAvailable).toBe(true);
    },
  );
});

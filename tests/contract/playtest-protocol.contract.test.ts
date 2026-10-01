import {
  classifyPlaytestFailure,
  executeActionTimeline,
  PlaytestProtocolClient,
} from '@gamerhub/playtest';
import { describe, expect, it } from 'vitest';

describe('Playtest protocol contract', () => {
  it('rejects mismatched handshake before actions', async () => {
    const client = new PlaytestProtocolClient({
      projectRevision: 'rev-1',
      gameSpecVersion: 'spec-1',
    });
    await expect(
      client.handshake({
        protocol_version: '9.0.0',
        project_revision: 'rev-1',
        game_spec_version: 'spec-1',
      }),
    ).rejects.toMatchObject({ code: 'PROTOCOL_MISMATCH' });
    expect(client.executedCommands).toHaveLength(0);
  });

  it('orders actions, respects cancellation and classifies infrastructure failures', async () => {
    const client = new PlaytestProtocolClient({
      projectRevision: 'rev-1',
      gameSpecVersion: 'spec-1',
    });
    await client.handshake({
      protocol_version: '1.0.0',
      project_revision: 'rev-1',
      game_spec_version: 'spec-1',
    });
    const controller = new AbortController();
    const result = await executeActionTimeline(
      client,
      [
        { command: 'input.jump', arguments: {} },
        { command: 'time.advance', arguments: { duration_ms: 20 } },
      ],
      controller.signal,
    );
    expect(result.every((item) => item.status === 'ok')).toBe(true);
    expect(classifyPlaytestFailure(new Error('probe disconnected'))).toBe(
      'infra_error',
    );
  });
});

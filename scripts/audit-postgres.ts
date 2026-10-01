import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { DurableSpecVersionService } from '../apps/platform-api/src/services/spec-version-service';
import { PostgresDomainRepository } from '../packages/domain/src/repositories/postgres';

async function main(): Promise<void> {
  // Run only against a disposable database, never the development data source.
  const connection = process.env.GAMERHUB_AUDIT_DATABASE_URL;
  if (
    !connection ||
    !/^gamerhub_logic_audit_[a-z0-9_]+$/.test(
      new URL(connection).pathname.slice(1),
    )
  )
    throw new Error('ISOLATED_AUDIT_DATABASE_REQUIRED');
  const repository = PostgresDomainRepository.fromConnectionString(connection);
  try {
    for (const file of (await readdir('infra/migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort())
      await repository.pool.query(
        await readFile(`infra/migrations/${file}`, 'utf8'),
      );
    const ownerId = randomUUID();
    await repository.pool.query(
      "INSERT INTO users (id, email, display_name, status, role) VALUES ($1, $2, 'Audit', 'active', 'creator')",
      [ownerId, `${ownerId}@audit.invalid`],
    );
    const project = await repository.createProject({
      ownerId,
      name: 'Audit',
      slug: 'audit',
      quotaProfile: 'standard',
    });
    const input = {
      ownerId,
      projectId: project.id,
      requestType: 'create' as const,
      userInput: 'runner',
      idempotencyKey: 'shared-key',
    };
    const concurrent = await Promise.all(
      Array.from({ length: 10 }, () => repository.createRun(input)),
    );
    assert.equal(concurrent.filter((result) => result.created).length, 1);
    assert.equal(new Set(concurrent.map((result) => result.run.id)).size, 1);
    await assert.rejects(
      repository.createRun({ ...input, userInput: 'changed' }),
      { code: 'IDEMPOTENCY_CONFLICT' },
    );
    await assert.rejects(
      repository.createRun({ ...input, idempotencyKey: 'second' }),
      { code: 'PROJECT_RUN_ACTIVE' },
    );
    const claimed = await repository.claimNextRun('first-worker', 60);
    assert.ok(claimed);
    await repository.updateRun(
      claimed.id,
      { leaseExpiresAt: new Date(Date.now() + 120_000).toISOString() },
      'first-worker',
    );
    assert.equal(await repository.claimNextRun('other-worker'), undefined);
    await repository.updateRun(claimed.id, {
      leaseExpiresAt: new Date(0).toISOString(),
    });
    assert.equal((await repository.claimNextRun('new-worker'))?.id, claimed.id);
    await assert.rejects(
      repository.updateRun(
        claimed.id,
        { leaseOwner: undefined },
        'first-worker',
      ),
      { code: 'RUN_LEASE_LOST' },
    );
    await repository.transitionRun(
      claimed.id,
      'playtesting',
      { visibility: 'creator', payload: {} },
      'new-worker',
    );
    await repository.transitionRun(
      claimed.id,
      'evaluating',
      { visibility: 'creator', payload: {} },
      'new-worker',
    );
    const completed = await repository.transitionRun(
      claimed.id,
      'succeeded',
      {
        eventType: 'run.succeeded',
        visibility: 'creator',
        payload: { previewUrl: 'https://preview.example/audit' },
      },
      'new-worker',
    );
    assert.equal(completed.run.resultSummary, 'https://preview.example/audit');
    assert.ok(completed.run.finishedAt);
    await repository.updateRun(
      claimed.id,
      { leaseOwner: undefined, leaseExpiresAt: undefined },
      'new-worker',
    );
    const mismatch = await repository.pool.query(
      'SELECT count(*) AS count FROM run_events e FULL JOIN event_outbox o ON e.run_id = o.run_id AND e.sequence = o.sequence WHERE e.run_id IS NULL OR o.run_id IS NULL',
    );
    assert.equal(Number(mismatch.rows[0]?.count), 0);
    assert.equal(
      Number(
        (
          await repository.pool.query(
            'SELECT count(*) AS count FROM agent_sessions',
          )
        ).rows[0]?.count,
      ),
      1,
    );
    const versionId = randomUUID();
    await repository.pool.query(
      "INSERT INTO game_spec_versions (id, project_id, version_number, source_run_id, change_type, summary, spec_json, content_hash, status) VALUES ($1, $2, 1, $3, 'create', 'audit version', '{}'::jsonb, 'sha256-audit', 'active')",
      [versionId, project.id, claimed.id],
    );
    const versions = new DurableSpecVersionService(repository, ownerId);
    assert.equal(
      ((await versions.list(project.id)) as Array<{ id: string }>)[0]?.id,
      versionId,
    );
    const restore = (await versions.restore(
      project.id,
      versionId,
      'restore-key',
    )) as { id: string; status: string };
    assert.equal(restore.status, 'queued');
    assert.equal(
      (
        (await versions.restore(project.id, versionId, 'restore-key')) as {
          id: string;
        }
      ).id,
      restore.id,
    );
    await assert.rejects(
      versions.restore(project.id, randomUUID()),
      /RESTORE_VERSION_NOT_FOUND/,
    );
    console.log(
      JSON.stringify({
        status: 'passed',
        concurrentRequests: 10,
        acceptedRuns: 1,
        orphanSessions: 0,
        eventOutboxMismatches: 0,
        leaseFencing: 'passed',
        atomicTerminalPreview: 'passed',
        durableRestoreContract: 'passed',
      }),
    );
  } finally {
    await repository.pool.end?.();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PostgresDomainRepository } from '../packages/domain/src/repositories/postgres';
import { loadEnvironmentFile } from './dev-env';

loadEnvironmentFile();
async function main(): Promise<void> {
  const cycle = JSON.parse(
    await readFile('artifacts/real-flow/cycle.json', 'utf8'),
  );
  assert.equal(cycle.status, 'passed');
  const repository = PostgresDomainRepository.fromEnvironment();
  try {
    const runs = await repository.pool.query(
      `SELECT r.id, r.request_type, r.status, r.lease_owner, b.id AS build_id,
       s.id AS spec_id, s.spec_json->'player'->'movement'->>'jump_height' AS jump_height,
       p.status AS preview_status, b.artifact_key
       FROM runs r JOIN checkpoints c ON c.source_run_id=r.id
       JOIN builds b ON b.checkpoint_id=c.id
       JOIN game_spec_versions s ON s.id=b.spec_version_id
       JOIN previews p ON p.build_id=b.id
       WHERE r.project_id=$1 ORDER BY r.created_at`,
      [cycle.projectId],
    );
    assert.equal(runs.rows.length, 3);
    assert.deepEqual(
      runs.rows.map((r) => r.request_type),
      ['create', 'modify', 'rollback'],
    );
    assert.deepEqual(
      runs.rows.map((r) => Number(r.jump_height)),
      [4, 6, 4],
    );
    for (const row of runs.rows) {
      assert.equal(row.status, 'succeeded');
      assert.equal(row.lease_owner, null);
    }
    assert.deepEqual(
      runs.rows.map((r) => r.preview_status),
      ['superseded', 'superseded', 'healthy'],
    );
    const project = (
      await repository.pool.query('SELECT * FROM projects WHERE id=$1', [
        cycle.projectId,
      ])
    ).rows[0];
    assert.equal(project?.current_spec_version_id, cycle.originalSpecId);
    assert.equal(project?.current_build_id, runs.rows.at(-1)?.build_id);
    const mismatch = await repository.pool.query(
      `SELECT count(*)::int AS count FROM run_events e FULL JOIN event_outbox o
       ON e.run_id=o.run_id AND e.sequence=o.sequence
       WHERE COALESCE(e.run_id,o.run_id) IN (SELECT id FROM runs WHERE project_id=$1)
       AND (e.run_id IS NULL OR o.run_id IS NULL)`,
      [cycle.projectId],
    );
    assert.equal(mismatch.rows[0]?.count, 0);
    const result = {
      status: 'passed',
      projectId: cycle.projectId,
      runs: runs.rows,
      eventOutboxMismatches: 0,
      currentSpecRestored: true,
    };
    await writeFile(
      'artifacts/real-flow/persistence-check.json',
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    await repository.close();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

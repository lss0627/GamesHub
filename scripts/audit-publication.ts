import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { OrchestratorWorker } from '../apps/orchestrator-worker/src/worker';
import { PostgresDomainRepository } from '../packages/domain/src/repositories/postgres';
import {
  MetadataCheckpointService,
  PostgresCheckpointMetadataStore,
} from '../packages/versioning/src/index';

async function main(): Promise<void> {
  const connection = process.env.GAMERHUB_AUDIT_DATABASE_URL;
  if (
    !connection ||
    !/^gamerhub_logic_audit_[a-z0-9_]+$/.test(
      new URL(connection).pathname.slice(1),
    )
  )
    throw new Error('ISOLATED_AUDIT_DATABASE_REQUIRED');
  const repository = PostgresDomainRepository.fromConnectionString(connection);
  const sql = repository.pool;
  try {
    for (const file of (await readdir('infra/migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort())
      await sql.query(await readFile(`infra/migrations/${file}`, 'utf8'));
    const ownerId = randomUUID();
    await sql.query(
      "INSERT INTO users (id,email,display_name,status,role) VALUES ($1,$2,'Audit','active','creator')",
      [ownerId, `${ownerId}@audit.invalid`],
    );
    const project = await repository.createProject({
      ownerId,
      name: 'Audit publication',
      slug: 'publication',
      quotaProfile: 'standard',
    });
    const createRun = async (projectId = project.id) =>
      (
        await repository.createRun({
          ownerId,
          projectId,
          requestType: 'create',
          userInput: 'runner',
          idempotencyKey: randomUUID(),
        })
      ).run;

    // Legacy snapshots can contain queued siblings despite current admission guards.
    const first = await createRun();
    const siblingId = randomUUID();
    await sql.query(
      "INSERT INTO runs (id,project_id,session_id,request_type,user_input,idempotency_key,trace_id) SELECT $2::uuid,project_id,session_id,'create','legacy',($2::uuid)::text,trace_id FROM runs WHERE id=$1",
      [first.id, siblingId],
    );
    const claims = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        repository.claimNextRun(`worker-${i}`),
      ),
    );
    assert.equal(claims.filter(Boolean).length, 1);
    const claimed = claims.find((run) => run !== undefined);
    assert.ok(claimed);
    const otherProject = await repository.createProject({
      ownerId,
      name: 'Other project',
      slug: 'other',
      quotaProfile: 'standard',
    });
    const otherRun = await createRun(otherProject.id);
    assert.equal(
      (await repository.claimNextRun('other-project-worker'))?.id,
      otherRun.id,
    );
    await repository.updateRun(otherRun.id, {
      status: 'cancelled',
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
    await repository.updateRun(claimed.id, {
      status: 'paused',
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
    assert.equal(
      await repository.claimNextRun('paused-sibling-worker'),
      undefined,
    );
    await sql.query(
      "UPDATE runs SET status='cancelled',lease_owner=NULL,lease_expires_at=NULL WHERE project_id=$1",
      [project.id],
    );

    async function prepare(
      runId: string,
      projectId: string,
      version: number,
      status: 'active' | 'proposed',
    ) {
      const specId = randomUUID();
      await sql.query(
        "INSERT INTO game_spec_versions (id,project_id,version_number,source_run_id,change_type,summary,spec_json,content_hash,status) VALUES ($1,$2,$3,$4,'create','audit','{}',($1::uuid)::text,$5)",
        [specId, projectId, version, runId, status],
      );
      const checkpointId = await repository.saveCheckpoint({
        projectId,
        specVersionId: specId,
        sourceRunId: runId,
        commitRef: 'audit',
        summary: 'audit',
        changeManifest: {},
        status: 'valid',
      });
      const buildInput = {
        projectId,
        checkpointId,
        specVersionId: specId,
        status: 'ready',
        engineVersion: 'audit',
        adapterVersion: 'audit',
        templateVersion: 'audit',
        packageLockHash: 'audit',
        artifactKey: `builds/${runId}`,
        contentHash: 'sha256-identical-bytes',
      };
      const buildId = await repository.saveBuild(buildInput);
      assert.equal(await repository.saveBuild(buildInput), buildId);
      const previewId = await repository.savePreview({
        projectId,
        sourceRunId: runId,
        buildContentHash: buildInput.contentHash,
        publicSlug: runId,
        origin: 'https://preview.example',
        status: status === 'active' ? 'healthy' : 'prepared',
      });
      return { specId, checkpointId, buildId, previewId };
    }
    const old = await prepare(first.id, project.id, 1, 'active');
    await sql.query(
      "UPDATE projects SET current_spec_version_id=$2,current_checkpoint_id=$3,current_build_id=$4,status='playable' WHERE id=$1",
      [project.id, old.specId, old.checkpointId, old.buildId],
    );
    const external = await prepare(otherRun.id, otherProject.id, 1, 'active');
    assert.notEqual(external.buildId, old.buildId);
    const nextRun = await createRun();
    const next = await prepare(nextRun.id, project.id, 2, 'proposed');
    assert.notEqual(next.buildId, old.buildId);
    await repository.claimNextRun('publisher', 120);
    await repository.transitionRun(
      nextRun.id,
      'executing',
      { visibility: 'developer', payload: {} },
      'publisher',
    );
    await repository.transitionRun(
      nextRun.id,
      'playtesting',
      { visibility: 'developer', payload: {} },
      'publisher',
    );
    await repository.transitionRun(
      nextRun.id,
      'evaluating',
      { visibility: 'developer', payload: {} },
      'publisher',
    );
    const publication = {
      projectId: project.id,
      runId: nextRun.id,
      workerId: 'publisher',
      specVersionId: next.specId,
      previewId: next.previewId,
      previewUrl: `https://preview.example/${nextRun.id}`,
      evidenceCount: 7,
    };
    const assertOld = async () => {
      const p = await repository.getProject(project.id, { ownerId });
      assert.equal(p.currentSpecVersionId, old.specId);
      assert.equal(
        (
          await sql.query(
            "SELECT id FROM previews WHERE project_id=$1 AND status='healthy'",
            [project.id],
          )
        ).rows[0]?.id,
        old.previewId,
      );
      assert.equal(
        (
          await sql.query(
            "SELECT id FROM game_spec_versions WHERE project_id=$1 AND status='active'",
            [project.id],
          )
        ).rows[0]?.id,
        old.specId,
      );
      assert.equal(
        (
          await sql.query('SELECT status FROM previews WHERE id=$1', [
            next.previewId,
          ])
        ).rows[0]?.status,
        'prepared',
      );
    };
    await assertOld();
    await assert.rejects(
      repository.commitRunPublication({
        ...publication,
        previewId: external.previewId,
      }),
      /PUBLICATION_EVIDENCE_MISMATCH/,
    );
    await assert.rejects(
      repository.commitRunPublication({
        ...publication,
        workerId: 'stale-owner',
      }),
      { code: 'RUN_LEASE_LOST' },
    );
    // Failure after all pointer updates must roll back the entire publication.
    await sql.query(
      "CREATE FUNCTION fail_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='run.succeeded' THEN RAISE EXCEPTION 'AUDIT_COMMIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER audit_outbox_failure BEFORE INSERT ON event_outbox FOR EACH ROW EXECUTE FUNCTION fail_publication()",
    );
    await assert.rejects(
      repository.commitRunPublication(publication),
      /AUDIT_COMMIT_FAILURE/,
    );
    await assertOld();
    assert.equal(
      (await repository.getRunForWorker(nextRun.id)).status,
      'evaluating',
    );
    assert.equal(
      (await repository.replayEvents(nextRun.id, 0)).filter(
        (e) => e.eventType === 'run.succeeded',
      ).length,
      0,
    );
    await sql.query(
      'DROP TRIGGER audit_outbox_failure ON event_outbox; DROP FUNCTION fail_publication()',
    );
    // A lease can expire while a transaction waits on a downstream write.
    await sql.query(
      "CREATE FUNCTION expire_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='run.succeeded' THEN UPDATE runs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=NEW.run_id; END IF; RETURN NEW; END $$; CREATE TRIGGER audit_lease_expiry BEFORE INSERT ON event_outbox FOR EACH ROW EXECUTE FUNCTION expire_publication()",
    );
    await assert.rejects(repository.commitRunPublication(publication), {
      code: 'RUN_LEASE_LOST',
    });
    await assertOld();
    await sql.query(
      'DROP TRIGGER audit_lease_expiry ON event_outbox; DROP FUNCTION expire_publication()',
    );
    const completed = await repository.commitRunPublication(publication);
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.leaseOwner, undefined);
    assert.equal(completed.resultSummary, publication.previewUrl);
    const pointers = (
      await sql.query('SELECT * FROM projects WHERE id=$1', [project.id])
    ).rows[0];
    assert.equal(pointers?.current_spec_version_id, next.specId);
    assert.equal(pointers?.current_build_id, next.buildId);
    assert.equal(pointers?.current_checkpoint_id, next.checkpointId);
    assert.equal(
      (
        await sql.query(
          "SELECT id FROM previews WHERE project_id=$1 AND status='healthy'",
          [project.id],
        )
      ).rows[0]?.id,
      next.previewId,
    );

    const cancelledRun = await createRun();
    const cancelled = await prepare(cancelledRun.id, project.id, 3, 'proposed');
    await repository.claimNextRun('cancelled-publisher');
    await repository.transitionRun(cancelledRun.id, 'cancelled', {
      visibility: 'creator',
      payload: {},
    });
    await assert.rejects(
      repository.commitRunPublication({
        ...publication,
        runId: cancelledRun.id,
        workerId: 'cancelled-publisher',
        specVersionId: cancelled.specId,
        previewId: cancelled.previewId,
      }),
    );
    assert.equal(
      (await repository.getProject(project.id, { ownerId }))
        .currentSpecVersionId,
      next.specId,
    );
    await repository.updateRun(cancelledRun.id, {
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });

    // Exercise the real Worker/repository seam, with deterministic engine outputs.
    const workerProject = await repository.createProject({
      ownerId,
      name: 'Worker seam',
      slug: 'worker',
      quotaProfile: 'standard',
    });
    const workerRun = await createRun(workerProject.id);
    const worker = new OrchestratorWorker({
      store: repository,
      checkpointService: new MetadataCheckpointService(
        new PostgresCheckpointMetadataStore(sql),
      ),
      sourceRevision: async () => 'audit-source',
      taskExecutorFactory: ({ run, context }) => ({
        execute: async (task) => {
          if (task.type === 'build') {
            assert.ok(context.specVersionId && context.checkpointId);
            await repository.saveBuild({
              projectId: run.projectId,
              specVersionId: context.specVersionId,
              checkpointId: context.checkpointId,
              status: 'ready',
              engineVersion: 'audit',
              adapterVersion: 'audit',
              templateVersion: 'audit',
              packageLockHash: 'audit',
              contentHash: 'sha256-worker-build',
              artifactKey: 'worker/build',
            });
          }
          return {
            taskId: task.id,
            status: 'completed',
            evidence: [
              'schema',
              'engine',
              'test',
              'playtest',
              'evaluation',
              'build',
            ].map((type) => ({
              type,
              reference: `audit://${task.id}`,
              contentHash: 'sha256-worker-build',
            })),
          };
        },
      }),
      publishPreview: async ({ projectId, runId, buildHash }) => {
        assert.equal(buildHash, 'sha256-worker-build');
        assert.equal(
          (
            await sql.query(
              "SELECT id FROM game_spec_versions WHERE project_id=$1 AND status='active'",
              [projectId],
            )
          ).rows.length,
          0,
        );
        return {
          healthy: true,
          url: `https://preview.example/${runId}`,
          buildHash,
        };
      },
    });
    assert.equal((await worker.processNext())?.status, 'succeeded');
    assert.equal(
      (await repository.getRunForWorker(workerRun.id)).status,
      'succeeded',
    );
    assert.ok(
      (await repository.getProject(workerProject.id, { ownerId }))
        .currentSpecVersionId,
    );
    const mismatches = await sql.query(
      'SELECT count(*) AS count FROM run_events e FULL JOIN event_outbox o ON e.run_id=o.run_id AND e.sequence=o.sequence WHERE e.run_id IS NULL OR o.run_id IS NULL',
    );
    assert.equal(Number(mismatches.rows[0]?.count), 0);
    console.log(
      JSON.stringify({
        status: 'passed',
        concurrentClaims: 12,
        sameProjectClaims: 1,
        independentProjects: 'passed',
        pausedSibling: 'passed',
        buildIsolationAndIdempotency: 'passed',
        preparedPreviewPreservesActive: 'passed',
        wrongRunAndLease: 'passed',
        outboxFailureRollback: 'passed',
        leaseExpiryDuringCommit: 'passed',
        atomicPublication: 'passed',
        cancellation: 'passed',
        workerPublication: 'passed',
        eventOutboxMismatches: 0,
      }),
    );
  } finally {
    await repository.close();
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

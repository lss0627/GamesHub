# Backup and restore runbook

## Scope

Back up PostgreSQL state, object storage assets/evidence/builds and the Git source repository. Credentials are supplied by the deployment secret manager and never copied into project state or evidence.

## Backup

1. Put new Runs into `waiting_for_engine` and stop new worker reservations.
2. Take a PostgreSQL consistent snapshot of migrations `001`–`003`; record the snapshot ID and schema hash.
3. Copy object storage using immutable/versioned keys and verify every object's SHA-256 content hash.
4. Mirror Git refs and checkpoint manifests; exclude `Library/`, temporary build output and license files.
5. Store a redacted manifest containing timestamps, counts and hashes in the audit store.

## Restore and verification

Restore PostgreSQL first, then objects and Git refs. Run `pnpm db:migrate`, verify owner predicates, recalculate object hashes, restore only `valid` checkpoints, and run contract, security and integration suites. Reconcile leases before re-enabling workers. If any editor or license return is uncertain, quarantine the worker and license until an operator verifies cleanup.

## Recovery objectives

The MVP target is RPO 15 minutes for control-plane state and RTO 60 minutes for a single project. A restored Preview must use its content hash and pass Evaluation plus Web smoke before publication.

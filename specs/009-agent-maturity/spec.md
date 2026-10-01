# Feature Specification: Reliable game-development Agent

**Feature**: 009-agent-maturity (workspace has no Git repository)
**Created**: 2026-09-09
**Status**: Ready for implementation planning
**Input**: 请你再进行仔细的审视，想着一个成熟的垂直类游戏开发agent 那样，补齐需要的缺点

## User Scenarios & Testing

### User Story 1 — Keep a game safe while iterating (P1)
A creator can change a game repeatedly without losing scene content or leaving a failed attempt mixed into the next attempt.
**Independent test**: add a project-owned scene object, change a number, then intentionally fail and cancel later changes. The scene object and original playable source survive.
**Acceptance**:
1. A parameter change or added mechanism preserves unrelated scene content and existing mechanisms.
2. Failed/cancelled attempts archive their work and restore the source present before the attempt; already published games remain usable.
3. Pause/resume retains in-progress work. A worker that loses ownership must not restore or change source.
4. Interrupted recovery remains detectable and retryable; missing/corrupt recovery data cannot be represented as successful restoration.

### User Story 2 — Know whether each requested behavior was checked (P1)
The creator receives evidence tied to each new mechanism requirement, not only a test count.
**Independent test**: request three behaviors but provide passing tests for only two; delivery is blocked and the missing behavior is identified.
**Acceptance**:
1. New mechanism requirements have stable identifiers and passed test results traceable to those identifiers.
2. Failed/skipped/missing checks do not count as covered. Detailed reports survive after a check process exits.
3. Older projects lacking the new mapping are identified as legacy evidence without fabricated coverage.

### User Story 3 — Receive a game that actually runs in its target browser (P1)
Before delivery, the system loads and interacts with the exact game build being delivered.
**Independent test**: a build with a valid file but broken loading/start/pause behavior is rejected; a valid build passes and produces visible evidence.
**Acceptance**:
1. Actual load, matching game identity, start, pause/resume and a genre-specific interaction are checked for all ten supported presets.
2. Unhandled runtime errors or unavailable browser checks block delivery with an actionable diagnosis.
3. Screenshots, observations and elapsed timings belong to the exact build and are retained.

### User Story 4 — Develop changes precisely (P2)
The Agent can edit a small section of a large script safely and handle adding, changing or retiring an explicitly requested mechanism.
**Independent test**: patch a unique fragment with a known revision; stale/ambiguous/partially failing patches leave the file unchanged. Retire a mechanism and verify that its old behavior no longer runs.
**Acceptance**:
1. Bounded edits are atomic and revision checked, preserve unrelated text, and create recovery receipts.
2. Add/change/remove requests do not silently become another genre or disappear from the plan.
3. Mechanism retirement includes implementation changes and negative behavior checks; removed requirements cannot merely disappear while code continues running.

### User Story 5 — Understand the delivery and remaining limits (P2)
The creator sees what changed, what was verified and what still requires review.
**Independent test**: inspect successful, failed and legacy runs in the workbench; each shows evidence appropriate to its actual status.
**Acceptance**:
1. Successful deliveries show base gameplay/browser checks and requirement coverage; prepared evidence is not shown as a committed success.
2. Failure recovery is explained separately from whether gameplay requirements passed.
3. Evidence contains no credentials or private host paths. Work from another project is never exposed.

### Edge Cases

- Worker stops between a source write and its receipt; recovery restarts, source journal exists but is incomplete.
- A project has no published version yet; cancelled work must still have a recoverable baseline.
- A creator changes genre intentionally; only that confirmed change may require a new scene composition.
- A development requirement is removed, renamed or has changed acceptance text.
- A test report says passed but required cases are absent or skipped.
- Browser startup fails, build identity mismatches, telemetry is absent, a game ends during a probe, or an asset request fails.
- Legacy scripts do not expose current telemetry or indexed acceptance cases; report the actual incompatibility and preserve prior builds.

## Requirements

- **FR-001**: Same-runtime modifications MUST preserve unrelated scene content and existing project-authored source.
- **FR-002**: Source mutation MUST have a durable per-attempt recovery baseline; failure/cancellation restores it after work stops, retaining failed source separately.
- **FR-003**: Pause and lost ownership MUST not trigger source rollback; completed publications MUST never be reversed by later diagnostics.
- **FR-004**: New development acceptance MUST be tied to individual passed cases; missing or inconclusive evidence blocks completion of that development task.
- **FR-005**: Original detailed test reports MUST be retained with integrity hashes.
- **FR-006**: Production delivery MUST check the actual target-browser build for identity, loading, lifecycle controls and core interaction.
- **FR-007**: Browser evidence MUST be retained and tied to the delivered build; unavailable checks fail explicitly.
- **FR-008**: Agent partial edits MUST require a current file revision, unique targets, atomic application and recoverable prior content.
- **FR-009**: Explicit mechanism retirement MUST remove its behavior and verify the retirement; requests must not be silently dropped.
- **FR-010**: Creator delivery status MUST distinguish verified, missing, legacy and failed checks, and expose source recovery status where relevant.
- **FR-011**: All new evidence and recovery operations MUST respect project boundaries and existing execution ownership.
- **FR-012**: Current capabilities and remaining maturity limitations MUST be documented from inspected code and actual acceptance.
- **FR-013**: Advertised production tools MUST perform the claimed operation. Unsupported batchmode scene/object/script/UI/session commands and unknown property writes fail explicitly; tests use the actual Unity Test Framework and retained XML. All preset creation plans use the implemented runtime composition entry.

### Key Entities

- Source attempt: project, run, baseline, archived failure content, outcome and recovery state.
- Requirement result: stable requirement identifier, expected behavior, actual case outcomes and evidence identity.
- Browser report: build identity, observations, errors, screenshots, timings and outcome.
- Delivery record: committed run identity, changes, verification coverage and remaining review items.

## Success Criteria

- **SC-001**: Scene-preservation, failure, cancellation, pause and lost-ownership acceptance scenarios all pass without altering previous published games.
- **SC-002**: A missing required behavior test and a deliberately broken browser build are both rejected.
- **SC-003**: Each of ten supported presets passes the production browser checker against an actual game build.
- **SC-004**: A real new-mechanism change and retirement complete with traceable behavior checks, and an interrupted or failed attempt can recover safely.
- **SC-005**: Full platform regression, production build and workbench delivery checks pass; the report lists exact results and remaining limits.

## Assumptions and Scope

Build on the existing single-creator local game platform and ten concrete 2D presets. This round closes observed reliability, validation and iterative-development gaps; it does not claim arbitrary commercial game production. Full visual scene authoring, animation/audio authoring, general 3D, multiplayer, open-world generation and subjective fun evaluation remain separate capabilities unless required by a concrete remediation. Preserve existing projects, source snapshots and published builds. The user has authorized implementing these fixes and their local acceptance; ordinary discussion still requires the product's explicit confirmation before starting a game run.

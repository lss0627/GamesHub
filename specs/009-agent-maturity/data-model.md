# Data model

## SourceAttempt (local project-owned journal)
Fields: schemaVersion, projectId, runId, baselineRevision, status(active/recovering/recovered/committed), archivedRevision?, finalRevision?, timestamps. IDs are safe path components and must match the enclosing project/run. Snapshots verified before restoration. Active resumes preserve edits; recovered repeats do not overwrite later work; committed attempts never roll back. At most one unfinished attempt may mutate a project.

## MechanismDevelopment (existing spec extension)
Existing id/description/acceptance plus optional operation(implement/retire) and acceptanceVersion(1). Omission preserves legacy representation. Prepared new/changed requests use indexed acceptance; prior active entries may only disappear through an explicit retirement plan. Retired entries retain negative regression tests.

## TestCaseEvidence
Full name, method/name, result, duration and report hash. XML source authoritative over process stdout. Case names indexed Acceptance_01… bind to the corresponding ordered criterion. Missing, skipped, failed or unrecognized result prevents required coverage. Detailed XML retained locally.

## BrowserReport
schemaVersion, project/run/spec/build identities, status, checks(id/label/status/observations), errors, timings, screenshot hashes and local references. Public projection excludes filesystem paths and arbitrary console content. Missing evidence is not passed.

## DeliverySummary and RecoverySummary (run events)
Delivery: matching run/spec/build, per-stage status, requirement rows, changed source counts/paths within project, warnings/review limits. Recovery: outcome plus source-archive availability, no host paths. Event prepared before publication is not a UI success until run committed.

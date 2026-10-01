# Research and decisions

## Source ownership
Decision: journal existing source snapshots per run and use worker completion boundaries. Rationale: current worker marks failure/cancel but leaves mutated source, while pause needs to preserve work. Alternative per-run Unity clones would multiply Library/import cost and require replacing all project-root tool contracts; avoid that in this local leased executor.

## Incremental scenes
Decision: preserve scenes for same-genre modification and run configuration import plus declared code development/tests. Rationale: current full non-runner plan recreates serialized objects even on parameter edits. Explicit genre changes retain composition.

## Acceptance evidence
Decision: retain authoritative NUnit reports and indexed criterion cases for newly prepared development. Rationale: test counts and ephemeral report paths cannot show which requirement passed. Keep legacy evidence explicit. Avoid claiming that a case-name contract proves subjective fun or defeats every possible tautological test.

## Browser gate
Decision: use existing Playwright installation and current telemetry/real inputs, tied to the actual artifact hash. Existing external preset tests supply known input locations; a bounded independent research task reviews robust probes and failure cases. No new framework/network dependency.

## Mechanism retirement and editing
Decision: explicit retirement stays in the declared mechanism history with negative regression tests; silent disappearance is rejected. Add atomic unique-fragment patching with hash checks. This reuses current fenced tools and avoids full-file generation/context pressure.

## Delivery
Decision: reuse tenant-scoped append-only run events for public summaries and local files for detailed diagnostics. UI shows evidence only for matching committed success; failed recovery is separate. No new database table required.

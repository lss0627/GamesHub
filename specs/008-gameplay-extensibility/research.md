# Design decisions

- Decision: per-file SHA256 baseline inside Assets/GamerHub/TemplateManifest.json. Rationale: existing project checkpoint captures Assets; compare previous baseline, current content and incoming template. Keep divergent local files. Alternatives: force copy loses work; skipping all updates strands unmodified files; a new VCS dependency is unnecessary.
- Decision: explicit development tasks with file tools unlocked in develop phase; execute_action remains evidence gate. Rationale: preserve ordinary deterministic actions and prevent failure as a prerequisite for coding. Alternative: unlock everything for every action obscures scope and costs model time.
- Decision: strict shared mechanism registry, type presets, concrete content. Rationale: finite contracts can be mapped and verified; arbitrary genre labels cannot prove capability.
- Decision: continue installed Unity, Pi and backend stack. No external package/API research required for these internal changes.

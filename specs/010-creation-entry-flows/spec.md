# One-sentence and detailed-discussion creation

User request 2026-09-09: run the entire process again; both one-sentence creation and detailed discussion must work.

## Required behavior

1. The workbench offers explicit “一句话制作” and “详细讨论” choices. Selecting a mode or an example does not itself start a run.
2. In one-sentence mode, submitting “直接制作” authorizes completing unspecified supported parameters with suitable defaults, preparing the exact specification and starting one run without extra conversation. The generated design remains available and the resulting game must pass normal publication checks.
3. Discussion mode preserves multi-turn choices and edits across reloads, allows reviewing a specification after at least one saved idea, and starts no run until explicit confirmation. No arbitrary two-message minimum.
4. Unsupported ideas remain visible with capability gaps; neither mode silently changes the requested game into a different supported genre. Model errors retain input and start no run. Existing revision, tenant, active-run and idempotent-confirmation controls remain enforced.
5. Both paths run from real browser input through actual model, durable admission, Unity execution, browser publication gate and interactive embedded preview in dedicated acceptance projects. Existing projects and previews remain preserved.

## Acceptance

- One short sentence creates a playable game with only one user message; no additional artificial confirmation messages.
- Multiple discussion turns retain explicit title/type/parameters, do not create a run, survive reload and deliver the exact reviewed specification after confirmation.
- Actual preview validates identity, start, core interaction, pause/resume and restart; supported browser delivery evidence is shown.
- Failure and unsupported-capability regressions prevent accidental admission; full appropriate regression and production checks pass.

One-sentence mode provides defaults within current 2D capabilities. General 3D, multiplayer, new art/animation and unsupported runtimes are not inferred as available.

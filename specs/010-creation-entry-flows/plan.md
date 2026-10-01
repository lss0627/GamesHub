# Implementation plan

Reuse DesignService.message/prepare/confirm and its durable revision/idempotency controls. Persist a bounded optional creationMode on the design document, with a validated transport field. Quick mode gives the planner an explicit complete-first-version instruction and orchestrates message -> prepare -> capability check -> confirm from the existing locked UI operation. Discussion keeps separate review/confirm controls. Both modes share the same immutable specification admission and actual validation pipeline.

Add mode-specific UI text and a compact accessible mode chooser; examples in quick mode only fill the input. A lost response leaves existing durable design/run state available to ordinary polling and explicit continuation; reload must never duplicate a confirmation.

Test-first: observe failing service, FastAPI and UI expectations, implement, then run actual dedicated browser scenarios. Keep current production services until build/verification succeeds; restart owned services only while every project and Unity is idle. No new infrastructure, database migrations or external permissions are required.

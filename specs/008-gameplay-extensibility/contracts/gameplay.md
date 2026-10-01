# Gameplay development contract

- Existing project/run APIs and tenant scope retained.
- Capability assessment must reject unknown fields and unsupported compositions with creator-readable gaps.
- Development is only allowed for explicitly planned unity.task.execute actions with the development capability; the host and Python registry agree on develop phase.
- Workspace tools stay inside the owning Unity project. No generic shell, credential access or test suppression.
- Successful execute_action must follow actual compile and required behavioral checks. Model prose never marks completion.
- Template migration returns relative paths and persistent conflict state. No conflicting file silently overwritten; manifests participate in source snapshots.

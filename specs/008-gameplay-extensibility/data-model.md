# Data model

TemplateManifest v1: templateHash and files keyed by relative Assets path, each with sourceHash and disposition (managed, preserved, deleted). Incoming template identities are hashes rather than mutable names. Report installed/updated/preserved/deleted paths without absolute host paths. A locally removed file with known baseline stays removed. Legacy differences remain preserved. Symlinks/reparse escapes rejected.

MechanismDefinition: id/version, allowed config keys with scalar validation, dependencies, runtime compatibility, input descriptors and test obligations. Genre preset references a finite list. Enabled duplicate mechanism types remain rejected until instance addressing exists.

DevelopmentTask: existing PlannerTask of script type, explicit capability, confirmed description and target files. State follows existing pending/running/completed/failed/cancelled workflow. Writes use expected file hash and backups; execute gate compiles/tests before completion.

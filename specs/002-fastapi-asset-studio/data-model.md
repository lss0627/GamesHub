# Data model

project_art_plans(project_id PK references projects, document JSONB, updated_at), RLS follows projects visibility.
ArtPlan: revision integer; status empty/generating/ready/failed; prompt; requirements[{role,description}]; candidates[{id,name,source,style,assets[{role,assetId,contentHash,name}]}]; selectedCandidateId?; generationId?; errorCode?; startedAt?.
Roles exactly cat, forest, coin, stump. One selected candidate must contain four unique roles. Each referenced asset must belong to the project, be approved and have a matching content hash.
Transitions: empty/ready/failed -> generating -> ready/failed; ready -> selected (status remains ready). CAS rejects stale writes; restart marks unfinished generation failed. Selecting invalidates prepared design atomically. A generating operation cannot be selected or overwritten.
GameSpec.assets maps cat->cat_player, forest->forest, coin->coin, stump->obstacle; source=upload, asset_id and content_hash bind immutable data. Builtin old specs without asset_id continue to work.
DesignDocument.artRevision / artCandidateId identify the reviewed selection. confirm rejects a different plan revision. Published currentSpec asset bindings are the authoritative applied state; draft selection is separate.

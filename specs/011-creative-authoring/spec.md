# Visual scene, animation and audio authoring

User request: maturely add the previously missing visual scene editing, animation and audio capabilities, with as complete an implementation as practical.

The supported first scope is the existing Unity 2D games: a 960 × 600 composition with named parented groups, sprite/rectangle/text objects, transforms, draw order, visibility by gameplay phase, keyframe tracks, event triggers and sound bindings. These are real Unity runtime elements. Existing procedural gameplay remains editable through its established design and code workflows; this feature does not pretend to expose every procedural object as a static Unity scene.

The editor must support pointer and keyboard editing, hierarchy and properties, undo/redo, scrub/play animation preview, image selection, PCM WAV import/preview, volume/loop/event binding, local unsaved draft recovery, optimistic concurrency and explicit save/build feedback. Save is durable draft state; applying starts the existing verified build pipeline. Revisions and rollback include the exact authoring document and content-hashed media.

Input limits, graph validity, asset ownership/type/hash and event allowlists are checked before persistence or Unity writes. Model authoring uses the same contract. Running projects cannot be edited. Audio and animation follow pause/restart and browser gesture rules. Tests must precede implementation and include a real Unity/WebGL acceptance project.

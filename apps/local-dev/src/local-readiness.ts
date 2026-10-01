import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function inspectUnityComponents(env: NodeJS.ProcessEnv) {
  const editor = env.UNITY_EDITOR_PATH ?? '';
  const editorFound = Boolean(editor && existsSync(editor));
  const webModuleFound =
    editorFound &&
    existsSync(
      join(dirname(editor), 'Data', 'PlaybackEngines', 'WebGLSupport'),
    );
  const templateFound = Boolean(
    env.UNITY_GOLDEN_PROJECT &&
      existsSync(
        join(env.UNITY_GOLDEN_PROJECT, 'ProjectSettings', 'ProjectVersion.txt'),
      ),
  );
  const code = !editorFound
    ? 'UNITY_EDITOR_NOT_FOUND'
    : !webModuleFound
      ? 'UNITY_WEB_MODULE_NOT_FOUND'
      : !templateFound
        ? 'UNITY_TEMPLATE_NOT_FOUND'
        : undefined;
  return {
    ready: !code,
    editorFound,
    webModuleFound,
    templateFound,
    license: 'checked-during-build' as const,
    ...(code ? { code } : {}),
  };
}

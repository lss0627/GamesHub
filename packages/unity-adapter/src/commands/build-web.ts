import { createHash, randomUUID } from 'node:crypto';
import type { BuildArtifact, WebBuildRequest } from '@gamerhub/engine-adapter';

export const unityWebBuildProfile = {
  id: 'runner-web-v1',
  engineVersion: '6000.0.80f1',
  target: 'unity_web' as const,
  compression: 'gzip',
  development: false,
};

export function createUnityWebBuildCommand(request: WebBuildRequest): {
  command: string[];
  outputPath: string;
} {
  if (
    !request.outputPath.startsWith('Builds/Web/') ||
    request.outputPath.includes('..')
  )
    throw new Error('WORKSPACE_ESCAPE');
  return {
    command: [
      '-batchmode',
      '-executeMethod',
      'GamerHub.AgentBridge.WebBuildCommand.Build',
      '-quit',
    ],
    outputPath: request.outputPath,
  };
}

export function normalizeWebBuildResult(
  request: WebBuildRequest,
  bytes = new Uint8Array(),
): BuildArtifact {
  const hash = `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
  return {
    operationId: randomUUID(),
    status: 'succeeded',
    changedFiles: [request.outputPath],
    warnings: [],
    errors: [],
    evidenceRefs: [],
    retryable: false,
    contentHash: hash,
    artifactPath: request.outputPath,
    provenance: {
      profile: unityWebBuildProfile.id,
      engineVersion: unityWebBuildProfile.engineVersion,
    },
  };
}

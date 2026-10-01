import { BuildService, type ImmutableBuild } from './build-service';

export class PreviewService {
  constructor(private readonly builds = new BuildService()) {}

  publish(input: {
    id: string;
    projectId: string;
    artifact: Uint8Array;
    evaluationPassed: boolean;
    webSmokePassed: boolean;
  }): ImmutableBuild {
    if (!input.evaluationPassed || !input.webSmokePassed)
      throw new Error('PREVIEW_GATE_FAILED');
    return this.builds.publish({
      id: input.id,
      projectId: input.projectId,
      bytes: input.artifact,
    });
  }

  current(projectId: string): ImmutableBuild | undefined {
    return this.builds.currentFor(projectId);
  }
}

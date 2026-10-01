export interface SkillPlan {
  skillId: string;
  skillVersion: string;
  input: Record<string, unknown>;
  requiredEngineCapabilities: string[];
  expectedRevision: string;
  changedArtifacts: string[];
}
export interface SkillResult {
  skillId: string;
  skillVersion: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  changedArtifacts: string[];
  evidence: Array<{
    type: string;
    reference: string;
  }>;
  checkpoint?: string;
  projectRevision?: string;
  error?: {
    code: string;
    message: string;
  };
}
export interface SkillPlanContext {
  engineType: 'unity' | string;
  currentRevision: string;
  capabilities?: string[];
  workspaceRoot?: string;
}
export interface SkillExecuteContext {
  expectedRevision: string;
  checkpointRef?: string;
  currentRevision?: string;
  compile?: () => Promise<boolean>;
  playtest?: () => Promise<boolean>;
  rollback?: () => Promise<void>;
}
export interface SkillValidationContext {
  requiredEvidence?: string[];
}
export interface GameSkill {
  readonly id: string;
  readonly version: string;
  readonly requiredEngineCapabilities: string[];
  plan(
    input: Record<string, unknown>,
    context: SkillPlanContext,
  ): Promise<SkillPlan>;
  execute(plan: SkillPlan, context: SkillExecuteContext): Promise<SkillResult>;
  validate(
    result: SkillResult,
    context: SkillValidationContext,
  ): Promise<{
    status: 'passed' | 'failed';
    reasons?: string[];
  }>;
}
export declare class GameSkillRegistry {
  private readonly skills;
  register(skill: GameSkill): this;
  get(id: string): GameSkill;
  list(): GameSkill[];
}
export declare function makeSkill(input: {
  id: string;
  version?: string;
  requiredEngineCapabilities: string[];
  artifacts: string[];
  validationReference: string;
}): GameSkill;

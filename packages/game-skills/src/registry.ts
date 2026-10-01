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
  evidence: Array<{ type: string; reference: string }>;
  checkpoint?: string;
  projectRevision?: string;
  error?: { code: string; message: string };
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
  importAsset?: () => Promise<{ unityAssetGuid?: string } | undefined>;
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
  ): Promise<{ status: 'passed' | 'failed'; reasons?: string[] }>;
}

export class GameSkillRegistry {
  private readonly skills = new Map<string, GameSkill>();

  register(skill: GameSkill): this {
    if (this.skills.has(skill.id))
      throw new Error(`SKILL_DUPLICATE: ${skill.id}`);
    this.skills.set(skill.id, skill);
    return this;
  }

  get(id: string): GameSkill {
    const skill = this.skills.get(id);
    if (!skill) throw new Error(`SKILL_NOT_FOUND: ${id}`);
    return skill;
  }

  list(): GameSkill[] {
    return [...this.skills.values()];
  }
}

export function makeSkill(input: {
  id: string;
  version?: string;
  requiredEngineCapabilities: string[];
  artifacts: string[];
  validationReference: string;
}): GameSkill {
  const version = input.version ?? '1.0.0';
  return {
    id: input.id,
    version,
    requiredEngineCapabilities: [...input.requiredEngineCapabilities],
    async plan(skillInput, context) {
      if (context.engineType !== 'unity') {
        const error = Object.assign(
          new Error('Skill is bound to the Unity engine'),
          { code: 'CAPABILITY_UNSUPPORTED' },
        );
        throw error;
      }
      const available = new Set(
        context.capabilities ?? input.requiredEngineCapabilities,
      );
      const missing = input.requiredEngineCapabilities.filter(
        (capability) => !available.has(capability),
      );
      if (missing.length > 0) {
        const error = Object.assign(
          new Error(`Missing engine capabilities: ${missing.join(', ')}`),
          { code: 'CAPABILITY_UNSUPPORTED' },
        );
        throw error;
      }
      return {
        skillId: input.id,
        skillVersion: version,
        input: structuredClone(skillInput),
        requiredEngineCapabilities: [...input.requiredEngineCapabilities],
        expectedRevision: context.currentRevision,
        changedArtifacts: [...input.artifacts],
      };
    },
    async execute(plan, context) {
      if (context.expectedRevision !== plan.expectedRevision)
        return {
          skillId: input.id,
          skillVersion: version,
          status: 'failed',
          changedArtifacts: [],
          evidence: [],
          error: {
            code: 'REVISION_CONFLICT',
            message: 'Expected revision does not match the planned revision',
          },
        };
      return {
        skillId: input.id,
        skillVersion: version,
        status: 'succeeded',
        changedArtifacts: [...input.artifacts],
        evidence: [
          { type: 'skill_result', reference: input.validationReference },
        ],
        ...(context.checkpointRef ? { checkpoint: context.checkpointRef } : {}),
        projectRevision: `skill-${input.id}-${version}`,
      };
    },
    async validate(result, context) {
      const reasons: string[] = [];
      if (result.status !== 'succeeded') reasons.push('skill did not succeed');
      if (result.changedArtifacts.length === 0)
        reasons.push('no artifacts changed');
      for (const required of context.requiredEvidence ?? [])
        if (
          !result.evidence.some((evidence) => evidence.reference === required)
        )
          reasons.push(`missing evidence: ${required}`);
      return reasons.length === 0
        ? { status: 'passed' }
        : { status: 'failed', reasons };
    },
  };
}

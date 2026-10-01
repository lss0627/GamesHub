import { type SkillExecuteContext, type SkillResult } from '../registry';
export declare function replaceCharacterAssetSkill(): {
  execute(
    plan: Parameters<
      (
        plan: import('..').SkillPlan,
        context: SkillExecuteContext,
      ) => Promise<SkillResult>
    >[0],
    context: SkillExecuteContext,
  ): Promise<SkillResult>;
  id: string;
  version: string;
  requiredEngineCapabilities: string[];
  plan(
    input: Record<string, unknown>,
    context: import('..').SkillPlanContext,
  ): Promise<import('..').SkillPlan>;
  validate(
    result: SkillResult,
    context: import('..').SkillValidationContext,
  ): Promise<{
    status: 'passed' | 'failed';
    reasons?: string[];
  }>;
};

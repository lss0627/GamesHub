import { executeAssetImportTransaction } from '@gamerhub/assets';
import {
  makeSkill,
  type SkillExecuteContext,
  type SkillResult,
} from '../registry';

export function replaceCharacterAssetSkill() {
  const base = makeSkill({
    id: 'replace_character_asset',
    requiredEngineCapabilities: ['asset.import', 'component.set_property'],
    artifacts: [
      'Assets/Game/Art/Player.png',
      'Assets/Game/Prefabs/Player.prefab',
    ],
    validationReference: 'AssetImportTests.StableLogicalMapping',
  });
  return {
    ...base,
    async execute(
      plan: Parameters<typeof base.execute>[0],
      context: SkillExecuteContext,
    ): Promise<SkillResult> {
      const result = await base.execute(plan, context);
      if (result.status !== 'succeeded') return result;

      const rollback = async (): Promise<void> => {
        await context.rollback?.();
      };
      const transaction = await executeAssetImportTransaction({
        importAsset: context.importAsset ?? (async () => undefined),
        compile: context.compile ?? (async () => true),
        playtest: context.playtest ?? (async () => true),
        rollback,
      });
      if (transaction.status === 'failed')
        return {
          ...result,
          status: 'failed',
          changedArtifacts: [],
          error: transaction.error ?? {
            code: 'ASSET_REPLACEMENT_VALIDATION_FAILED',
            message: 'Asset replacement validation failed',
          },
        };
      return {
        ...result,
        evidence: [...result.evidence, ...transaction.evidence],
      };
    },
  };
}

export interface AssetImportExecution {
  importAsset: () => Promise<{ unityAssetGuid?: string } | undefined>;
  compile: () => Promise<boolean>;
  playtest: () => Promise<boolean>;
  rollback: () => Promise<void>;
}

export interface AssetImportTransactionResult {
  status: 'imported' | 'failed';
  rollbackPerformed: boolean;
  unityAssetGuid?: string;
  evidence: Array<{ type: string; reference: string }>;
  error?: { code: string; message: string };
  rollbackError?: { code: string; message: string };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Runs the non-atomic Unity portion of an asset replacement behind an
 * explicit rollback boundary. The metadata transaction wraps this helper so
 * a failed compile/playtest cannot be reported as an imported asset.
 */
export async function executeAssetImportTransaction(
  execution: AssetImportExecution,
): Promise<AssetImportTransactionResult> {
  let importStarted = false;
  let imported: { unityAssetGuid?: string } | undefined;
  try {
    importStarted = true;
    imported = await execution.importAsset();
    if (!(await execution.compile()))
      throw Object.assign(new Error('The replacement asset did not compile'), {
        code: 'COMPILE_FAILED',
      });
    if (!(await execution.playtest()))
      throw Object.assign(
        new Error('The replacement asset failed the Runner smoke playtest'),
        { code: 'PLAYTEST_FAILED' },
      );
    return {
      status: 'imported',
      rollbackPerformed: false,
      ...(imported?.unityAssetGuid
        ? { unityAssetGuid: imported.unityAssetGuid }
        : {}),
      evidence: [
        { type: 'import', reference: 'UnityAssetImported' },
        { type: 'compile', reference: 'UnityCompilePassed' },
        { type: 'playtest', reference: 'RunnerAssetReplacementSmoke' },
      ],
    };
  } catch (error) {
    let rollbackError: AssetImportTransactionResult['rollbackError'];
    if (importStarted) {
      try {
        await execution.rollback();
      } catch (rollbackFailure) {
        rollbackError = {
          code: 'ROLLBACK_FAILED',
          message: errorMessage(rollbackFailure, 'Asset rollback failed'),
        };
      }
    }
    const errorRecord =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'ASSET_IMPORT_FAILED';
    return {
      status: 'failed',
      rollbackPerformed: importStarted,
      evidence: [],
      error: rollbackError
        ? {
            code: rollbackError.code,
            message: `${errorRecord}: ${errorMessage(error, 'Asset import failed')}`,
          }
        : {
            code: errorRecord,
            message: errorMessage(error, 'Asset import failed'),
          },
      ...(rollbackError ? { rollbackError } : {}),
    };
  }
}

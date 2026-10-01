import { ingestAudio } from './audio';
import {
  type AssetImportExecution,
  type AssetImportTransactionResult,
  executeAssetImportTransaction,
} from './import-transaction';
import {
  type AssetImportStatus,
  type AssetScanner,
  type ImageDecoder,
  type IngestedAsset,
  ingestImage,
  ingestImageDurable,
} from './ingest';
import {
  type AssetMetadataStore,
  type AssetUsageRecord,
  InMemoryAssetMetadataStore,
} from './metadata-store';
import { type AssetObjectStore, InMemoryObjectStore } from './object-store';

export type AssetUsage = AssetUsageRecord;

export interface AssetImportRequest {
  projectId: string;
  assetId: string;
  targetPath: string;
  specVersionId?: string;
  logicalEntityId?: string;
  usageKind?: AssetUsageRecord['usageKind'];
}

export type AssetImportResult = AssetImportTransactionResult & {
  assetId: string;
  targetPath: string;
};

function assertUnityAssetPath(path: string): void {
  const segments = path.split('/');
  if (
    !path.startsWith('Assets/') ||
    segments.some(
      (segment) => !segment || segment === '.' || segment === '..',
    ) ||
    path.includes('\\') ||
    path.includes('\0')
  )
    throw new Error('WORKSPACE_ESCAPE');
}

export class AssetRepository {
  private readonly objectStore: AssetObjectStore;
  private readonly metadataStore: AssetMetadataStore;
  private readonly scanner: AssetScanner | undefined;
  private readonly decoder: ImageDecoder | undefined;
  private readonly ownerId: string | undefined;

  constructor(
    options: {
      objectStore?: AssetObjectStore;
      metadataStore?: AssetMetadataStore;
      scanner?: AssetScanner;
      decoder?: ImageDecoder;
      ownerId?: string;
    } = {},
  ) {
    this.objectStore = options.objectStore ?? new InMemoryObjectStore();
    this.metadataStore =
      options.metadataStore ?? new InMemoryAssetMetadataStore();
    this.scanner = options.scanner;
    this.decoder = options.decoder;
    this.ownerId = options.ownerId;
    if ((this.scanner && !this.decoder) || (!this.scanner && this.decoder))
      throw new Error('ASSET_PIPELINE_CONFIG_INVALID');
  }

  async upload(
    input: Parameters<typeof ingestImage>[0],
  ): Promise<IngestedAsset> {
    let asset: IngestedAsset;
    if (input.mimeType === 'audio/wav') {
      if (!this.scanner && !(this.objectStore instanceof InMemoryObjectStore))
        throw new Error('ASSET_PIPELINE_CONFIG_REQUIRED');
      asset = await ingestAudio(
        {
          ...input,
          licenseText: input.licenseText ?? input.license?.text ?? '',
        },
        this.objectStore,
        this.scanner,
      );
    } else if (this.scanner && this.decoder) {
      asset = await ingestImageDurable(
        input,
        this.objectStore,
        this.scanner,
        this.decoder,
      );
    } else {
      if (!(this.objectStore instanceof InMemoryObjectStore))
        throw new Error('ASSET_PIPELINE_CONFIG_REQUIRED');
      asset = ingestImage(input, this.objectStore);
    }
    await this.metadataStore.save(asset, this.ownerId);
    return structuredClone(asset);
  }

  list(projectId: string): Promise<IngestedAsset[]> {
    return this.metadataStore.list(projectId, this.ownerId);
  }

  async readAsset(
    projectId: string,
    assetId: string,
  ): Promise<{ asset: IngestedAsset; bytes: Uint8Array }> {
    const asset = (await this.metadataStore.list(projectId, this.ownerId)).find(
      (item) => item.id === assetId,
    );
    if (!asset) throw new Error('ASSET_NOT_FOUND');
    if (asset.securityStatus !== 'approved')
      throw new Error('ASSET_SECURITY_APPROVAL_REQUIRED');
    const stored = await this.objectStore.get(asset.objectKey);
    if (stored.contentHash !== asset.contentHash)
      throw new Error('ASSET_CONTENT_HASH_MISMATCH');
    return {
      asset: structuredClone(asset),
      bytes: new Uint8Array(stored.bytes),
    };
  }

  async updateImportStatus(
    projectId: string,
    assetId: string,
    importStatus: AssetImportStatus,
  ): Promise<void> {
    const asset = (await this.metadataStore.list(projectId, this.ownerId)).find(
      (item) => item.id === assetId,
    );
    if (!asset) throw new Error('ASSET_NOT_FOUND');
    await this.metadataStore.updateImportStatus(
      assetId,
      importStatus,
      this.ownerId,
    );
  }

  async importAsset(
    request: AssetImportRequest,
    execution: AssetImportExecution,
  ): Promise<AssetImportResult> {
    assertUnityAssetPath(request.targetPath);
    if (
      (request.specVersionId || request.logicalEntityId || request.usageKind) &&
      (!request.specVersionId || !request.logicalEntityId || !request.usageKind)
    )
      throw new Error('ASSET_USAGE_CONTEXT_REQUIRED');
    const asset = (
      await this.metadataStore.list(request.projectId, this.ownerId)
    ).find((item) => item.id === request.assetId);
    if (!asset) throw new Error('ASSET_NOT_FOUND');
    if (asset.securityStatus !== 'approved')
      throw new Error('ASSET_SECURITY_APPROVAL_REQUIRED');

    await this.metadataStore.updateImportStatus(
      asset.id,
      'pending',
      this.ownerId,
    );
    const transaction = await executeAssetImportTransaction(execution);
    if (transaction.status === 'failed') {
      await this.metadataStore.updateImportStatus(
        asset.id,
        'failed',
        this.ownerId,
      );
      return {
        ...transaction,
        assetId: asset.id,
        targetPath: request.targetPath,
      };
    }

    try {
      if (request.specVersionId && request.logicalEntityId && request.usageKind)
        await this.addUsage({
          assetId: asset.id,
          projectId: request.projectId,
          logicalEntityId: request.logicalEntityId,
          relativePath: request.targetPath,
          usageKind: request.usageKind,
          ...(transaction.unityAssetGuid
            ? { unityAssetGuid: transaction.unityAssetGuid }
            : {}),
          introducedSpecVersionId: request.specVersionId,
        });
      await this.metadataStore.updateImportStatus(
        asset.id,
        'imported',
        this.ownerId,
      );
      return {
        ...transaction,
        assetId: asset.id,
        targetPath: request.targetPath,
      };
    } catch (error) {
      let rollbackError: AssetImportTransactionResult['rollbackError'];
      try {
        await execution.rollback();
      } catch (rollbackFailure) {
        rollbackError = {
          code: 'ROLLBACK_FAILED',
          message:
            rollbackFailure instanceof Error
              ? rollbackFailure.message
              : 'Asset rollback failed',
        };
      }
      await this.metadataStore.updateImportStatus(
        asset.id,
        'failed',
        this.ownerId,
      );
      return {
        status: 'failed',
        rollbackPerformed: true,
        evidence: transaction.evidence,
        assetId: asset.id,
        targetPath: request.targetPath,
        error: rollbackError
          ? {
              code: rollbackError.code,
              message:
                error instanceof Error
                  ? error.message
                  : 'Asset import commit failed',
            }
          : {
              code: 'ASSET_IMPORT_COMMIT_FAILED',
              message:
                error instanceof Error
                  ? error.message
                  : 'Asset import commit failed',
            },
        ...(rollbackError ? { rollbackError } : {}),
      };
    }
  }

  async addUsage(usage: AssetUsage): Promise<AssetUsage> {
    const assets = await this.metadataStore.list(usage.projectId, this.ownerId);
    if (!assets.some((asset) => asset.id === usage.assetId))
      throw new Error('ASSET_NOT_FOUND');
    if (usage.relativePath.startsWith('/') || usage.relativePath.includes('..'))
      throw new Error('WORKSPACE_ESCAPE');
    await this.metadataStore.addUsage(usage, this.ownerId);
    return structuredClone(usage);
  }

  listUsage(projectId: string): Promise<AssetUsage[]> {
    return this.metadataStore.listUsage(projectId, this.ownerId);
  }
}

export function createAssetRoutes(repository: AssetRepository) {
  return {
    upload: (input: Parameters<AssetRepository['upload']>[0]) =>
      repository.upload(input),
    list: async (projectId: string) => ({
      items: await repository.list(projectId),
    }),
    importAsset: (input: AssetImportRequest, execution: AssetImportExecution) =>
      repository.importAsset(input, execution),
  };
}

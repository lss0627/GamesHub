import type { AssetImportStatus, IngestedAsset } from './ingest';

export interface AssetUsageRecord {
  assetId: string;
  projectId: string;
  logicalEntityId: string;
  relativePath: string;
  usageKind: 'player' | 'background' | 'ui' | 'other';
  unityAssetGuid?: string;
  introducedSpecVersionId?: string;
  removedSpecVersionId?: string;
}

export interface AssetMetadataStore {
  save(asset: IngestedAsset, ownerId?: string): Promise<void>;
  updateImportStatus(
    assetId: string,
    importStatus: AssetImportStatus,
    ownerId?: string,
  ): Promise<void>;
  list(projectId: string, ownerId?: string): Promise<IngestedAsset[]>;
  addUsage(usage: AssetUsageRecord, ownerId?: string): Promise<void>;
  listUsage(projectId: string, ownerId?: string): Promise<AssetUsageRecord[]>;
}

export class InMemoryAssetMetadataStore implements AssetMetadataStore {
  private readonly assets = new Map<string, IngestedAsset>();
  private readonly usages: AssetUsageRecord[] = [];

  async save(asset: IngestedAsset): Promise<void> {
    this.assets.set(asset.id, structuredClone(asset));
  }

  async updateImportStatus(
    assetId: string,
    importStatus: AssetImportStatus,
  ): Promise<void> {
    const asset = this.assets.get(assetId);
    if (!asset) throw new Error('ASSET_NOT_FOUND');
    asset.importStatus = importStatus;
  }

  async list(projectId: string): Promise<IngestedAsset[]> {
    return [...this.assets.values()]
      .filter((asset) => asset.projectId === projectId)
      .map((asset) => structuredClone(asset));
  }

  async addUsage(usage: AssetUsageRecord): Promise<void> {
    if (!this.assets.has(usage.assetId)) throw new Error('ASSET_NOT_FOUND');
    this.usages.push(structuredClone(usage));
  }

  async listUsage(projectId: string): Promise<AssetUsageRecord[]> {
    return this.usages
      .filter((usage) => usage.projectId === projectId)
      .map((usage) => structuredClone(usage));
  }
}

export interface AssetSqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}

export type AssetTenantTransaction = <T>(
  ownerId: string,
  operation: (client: AssetSqlExecutor) => Promise<T>,
) => Promise<T>;

function stringValue(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowToAsset(row: Record<string, unknown>): IngestedAsset {
  const metadata =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : {};
  const scanReportReference = metadata.scanReportReference;
  return {
    id: stringValue(row.id),
    projectId: stringValue(row.project_id),
    createdByRunId: row.created_by_run_id
      ? stringValue(row.created_by_run_id)
      : 'durable-upload',
    name: stringValue(row.name),
    mediaType: stringValue(row.media_type),
    objectKey: stringValue(row.object_key),
    contentHash: stringValue(row.content_hash),
    sizeBytes: Number(row.size_bytes),
    securityStatus: 'approved',
    importStatus: row.import_status as IngestedAsset['importStatus'],
    licenseText: row.license_text ? stringValue(row.license_text) : '',
    ...(typeof scanReportReference === 'string' ? { scanReportReference } : {}),
  };
}

/**
 * PostgreSQL metadata adapter. The supplied executor must be a tenant-scoped
 * transaction or a worker role with equivalent RLS enforcement.
 */
export class PostgresAssetMetadataStore implements AssetMetadataStore {
  constructor(
    private readonly db: AssetSqlExecutor,
    private readonly tenantTransaction?: AssetTenantTransaction,
  ) {}

  private scoped<T>(
    ownerId: string | undefined,
    operation: (db: AssetSqlExecutor) => Promise<T>,
  ): Promise<T> {
    return ownerId && this.tenantTransaction
      ? this.tenantTransaction(ownerId, operation)
      : operation(this.db);
  }

  async save(asset: IngestedAsset, ownerId?: string): Promise<void> {
    await this.scoped(ownerId, (db) =>
      db
        .query(
          `INSERT INTO assets
        (id, project_id, type, name, source, license_text, object_key, content_hash,
         media_type, size_bytes, metadata, security_status, import_status, created_by_run_id)
       VALUES ($1, $2, 'image', $3, 'upload', $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
       ON CONFLICT (id) DO NOTHING`,
          [
            asset.id,
            asset.projectId,
            asset.name,
            asset.licenseText,
            asset.objectKey,
            asset.contentHash,
            asset.mediaType,
            asset.sizeBytes,
            JSON.stringify(
              'scanReportReference' in asset
                ? {
                    scanReportReference: (
                      asset as IngestedAsset & { scanReportReference?: string }
                    ).scanReportReference,
                  }
                : {},
            ),
            asset.securityStatus,
            asset.importStatus,
            // Standalone uploads have no generating run; PostgreSQL stores that as NULL.
            ['api-upload', 'durable-upload'].includes(asset.createdByRunId)
              ? null
              : asset.createdByRunId,
          ],
        )
        .then(() => undefined),
    );
  }

  async list(projectId: string, ownerId?: string): Promise<IngestedAsset[]> {
    const result = await this.scoped(ownerId, (db) =>
      db.query(
        "SELECT * FROM assets WHERE project_id = $1 AND security_status = 'approved' ORDER BY created_at, id",
        [projectId],
      ),
    );
    return result.rows.map(rowToAsset);
  }

  async updateImportStatus(
    assetId: string,
    importStatus: AssetImportStatus,
    ownerId?: string,
  ): Promise<void> {
    await this.scoped(ownerId, async (db) => {
      const result = await db.query(
        `UPDATE assets
         SET import_status = $2
         WHERE id = $1
         RETURNING id`,
        [assetId, importStatus],
      );
      if (result.rows.length === 0) throw new Error('ASSET_NOT_FOUND');
    });
  }

  async addUsage(usage: AssetUsageRecord, ownerId?: string): Promise<void> {
    if (!usage.introducedSpecVersionId)
      throw new Error('ASSET_USAGE_SPEC_VERSION_REQUIRED');
    await this.scoped(ownerId, (db) =>
      db
        .query(
          `INSERT INTO asset_usages
        (asset_id, project_id, logical_entity_id, unity_asset_guid, relative_path,
         usage_kind, introduced_spec_version_id, removed_spec_version_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (asset_id, logical_entity_id, relative_path)
       DO UPDATE SET removed_spec_version_id = EXCLUDED.removed_spec_version_id`,
          [
            usage.assetId,
            usage.projectId,
            usage.logicalEntityId,
            usage.unityAssetGuid ?? null,
            usage.relativePath,
            usage.usageKind,
            usage.introducedSpecVersionId,
            usage.removedSpecVersionId ?? null,
          ],
        )
        .then(() => undefined),
    );
  }

  async listUsage(
    projectId: string,
    ownerId?: string,
  ): Promise<AssetUsageRecord[]> {
    const result = await this.scoped(ownerId, (db) =>
      db.query(
        `SELECT asset_id, project_id, logical_entity_id, unity_asset_guid,
              relative_path, usage_kind, introduced_spec_version_id,
              removed_spec_version_id
       FROM asset_usages WHERE project_id = $1 ORDER BY logical_entity_id, relative_path`,
        [projectId],
      ),
    );
    return result.rows.map((row) => ({
      assetId: stringValue(row.asset_id),
      projectId: stringValue(row.project_id),
      logicalEntityId: stringValue(row.logical_entity_id),
      relativePath: stringValue(row.relative_path),
      usageKind: row.usage_kind as AssetUsageRecord['usageKind'],
      ...(row.unity_asset_guid
        ? { unityAssetGuid: stringValue(row.unity_asset_guid) }
        : {}),
      ...(row.introduced_spec_version_id
        ? {
            introducedSpecVersionId: stringValue(
              row.introduced_spec_version_id,
            ),
          }
        : {}),
      ...(row.removed_spec_version_id
        ? { removedSpecVersionId: stringValue(row.removed_spec_version_id) }
        : {}),
    }));
  }
}

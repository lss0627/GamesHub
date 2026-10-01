import { AssetRepository, PostgresAssetMetadataStore } from '@gamerhub/assets';
import { expect, it } from 'vitest';

it('stores uploads without a generating run as NULL and only reads approved assets', async () => {
  const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  const metadata = new PostgresAssetMetadataStore({
    query: async (sql, values) => {
      calls.push({ sql, values: values ?? [] });
      return { rows: [] };
    },
  });
  const repository = new AssetRepository({ metadataStore: metadata });
  await repository.upload({
    projectId: 'project',
    createdByRunId: 'api-upload',
    name: 'cat.png',
    mimeType: 'image/png',
    bytes: new Uint8Array([137, 80, 78, 71]),
    licenseText: 'Original artwork',
  });
  expect(calls[0]?.values.at(-1)).toBeNull();
  await repository.list('project');
  expect(calls[1]?.sql).toContain("security_status = 'approved'");
});

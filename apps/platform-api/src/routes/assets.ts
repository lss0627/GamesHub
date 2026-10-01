import type {
  AssetImportExecution,
  AssetImportRequest,
  AssetRepository,
} from '@gamerhub/assets';

export function createAssetRoutesForApi(repository: AssetRepository) {
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

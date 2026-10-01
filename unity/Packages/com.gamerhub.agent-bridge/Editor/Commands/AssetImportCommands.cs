using System;
using System.Collections.Generic;
using UnityEditor;

namespace GamerHub.AgentBridge
{
    public static class AssetImportCommands
    {
        private static readonly Dictionary<string, string> LogicalGuidMap = new Dictionary<string, string>(StringComparer.Ordinal);

        public static bool IsAllowedMime(string mimeType) => mimeType == "image/png" || mimeType == "image/jpeg" || mimeType == "image/webp";

        public static string RegisterLogicalAsset(string logicalId, string assetPath)
        {
            AgentCommandRegistry.Demand("asset.import");
            if (string.IsNullOrWhiteSpace(logicalId)) throw new ArgumentException("logical id is required", nameof(logicalId));
            ValidateAssetPath(assetPath);
            var guid = AssetDatabase.AssetPathToGUID(assetPath);
            if (string.IsNullOrWhiteSpace(guid)) throw new InvalidOperationException("ASSET_GUID_NOT_FOUND");
            LogicalGuidMap[logicalId.Trim().ToLowerInvariant()] = guid;
            return guid;
        }

        public static string ResolveLogicalAsset(string logicalId)
        {
            if (!LogicalGuidMap.TryGetValue(logicalId.Trim().ToLowerInvariant(), out var guid))
                throw new InvalidOperationException("LOGICAL_ASSET_NOT_FOUND");
            return guid;
        }

        public static void ImportSprite(string assetPath)
        {
            AgentCommandRegistry.Demand("asset.import");
            ValidateAssetPath(assetPath);
            var importer = AssetImporter.GetAtPath(assetPath) as TextureImporter;
            if (importer == null) throw new InvalidOperationException("SPRITE_IMPORTER_NOT_FOUND");
            importer.textureType = TextureImporterType.Sprite;
            importer.spriteImportMode = SpriteImportMode.Single;
            importer.SaveAndReimport();
        }

        private static void ValidateAssetPath(string assetPath)
        {
            if (!assetPath.StartsWith("Assets/", StringComparison.Ordinal) || assetPath.Contains(".."))
                throw new InvalidOperationException("WORKSPACE_ESCAPE");
        }
    }
}

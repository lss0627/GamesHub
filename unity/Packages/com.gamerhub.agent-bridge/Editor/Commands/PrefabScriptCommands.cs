using System;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;

namespace GamerHub.AgentBridge
{
    public static class PrefabScriptCommands
    {
        public static GameObject SavePrefab(GameObject source, string assetPath)
        {
            AgentCommandRegistry.Demand("prefab.create");
            if (source == null) throw new ArgumentNullException(nameof(source));
            if (!assetPath.StartsWith("Assets/", StringComparison.Ordinal) || assetPath.Contains(".."))
                throw new InvalidOperationException("WORKSPACE_ESCAPE: prefab path must be under Assets");
            return PrefabUtility.SaveAsPrefabAsset(source, assetPath);
        }

        public static void AssertSafeScriptPath(string assetPath)
        {
            AgentCommandRegistry.Demand("script.create");
            if (!assetPath.StartsWith("Assets/", StringComparison.Ordinal) || assetPath.Contains("..") || !assetPath.EndsWith(".cs", StringComparison.Ordinal))
                throw new InvalidOperationException("SCRIPT_PATH_NOT_ALLOWED");
        }

        public static void RequestCompile()
        {
            AgentCommandRegistry.Demand("compile");
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
            CompilationPipeline.RequestScriptCompilation();
        }
    }
}

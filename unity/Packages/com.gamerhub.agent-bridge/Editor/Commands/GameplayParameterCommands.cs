using System;
using UnityEditor;
using UnityEngine;

namespace GamerHub.AgentBridge
{
    public static class GameplayParameterCommands
    {
        public static void SetJumpVelocity(string assetPath, float value)
        {
            AgentCommandRegistry.Demand("component.set_property");
            if (!assetPath.StartsWith("Assets/", StringComparison.Ordinal) || assetPath.Contains(".."))
                throw new InvalidOperationException("WORKSPACE_ESCAPE");
            if (value < 0f || value > 100f) throw new ArgumentOutOfRangeException(nameof(value));
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
            if (prefab == null) throw new InvalidOperationException("PREFAB_NOT_FOUND");
            var player = Array.Find(prefab.GetComponentsInChildren<MonoBehaviour>(true), component => component != null && component.GetType().Name == "PlayerController");
            if (player == null) throw new InvalidOperationException("PLAYER_COMPONENT_NOT_FOUND");
            var serialized = new SerializedObject(player);
            var jumpVelocity = serialized.FindProperty("jumpVelocity");
            if (jumpVelocity == null) throw new InvalidOperationException("JUMP_PARAMETER_NOT_FOUND");
            jumpVelocity.floatValue = value;
            serialized.ApplyModifiedPropertiesWithoutUndo();
            AssetDatabase.SaveAssets();
            AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceUpdate);
        }
    }
}

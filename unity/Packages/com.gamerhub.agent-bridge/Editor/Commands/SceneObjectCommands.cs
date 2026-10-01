using System;
using UnityEditor;
using UnityEngine;

namespace GamerHub.AgentBridge
{
    public static class SceneObjectCommands
    {
        public static string NormalizeLogicalId(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException("logical id is required", nameof(value));
            return value.Trim().ToLowerInvariant().Replace(" ", "_");
        }

        public static GameObject Create(string logicalId, Vector3 position)
        {
            AgentCommandRegistry.Demand("game_object.create");
            var gameObject = new GameObject(NormalizeLogicalId(logicalId)) { transform = { position = position } };
            Undo.RegisterCreatedObjectUndo(gameObject, "GamerHub create GameObject");
            return gameObject;
        }

        public static void Remove(GameObject gameObject)
        {
            AgentCommandRegistry.Demand("game_object.remove");
            if (gameObject == null) throw new ArgumentNullException(nameof(gameObject));
            Undo.DestroyObjectImmediate(gameObject);
        }

        public static void SetPosition(GameObject gameObject, Vector3 position)
        {
            AgentCommandRegistry.Demand("scene.edit");
            if (gameObject == null) throw new ArgumentNullException(nameof(gameObject));
            Undo.RecordObject(gameObject.transform, "GamerHub move GameObject");
            gameObject.transform.position = position;
        }
    }
}

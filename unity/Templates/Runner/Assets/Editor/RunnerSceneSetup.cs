using System.IO;
using GamerHub.Runner;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GamerHub.Runner.Editor
{
    public static class RunnerSceneSetup
    {
        public const string ScenePath = "Assets/Game/Scenes/Runner.unity";

        public static void Ensure()
        {
            Directory.CreateDirectory("Assets/Game/Scenes");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            RunnerGameConfig.Reload();
            var runtime = RunnerGameConfig.Current.runtime;
            var manager = new GameObject("GamerHubGame");
            if (runtime == "arena-v1") manager.AddComponent<ArenaGame>();
            else if (runtime == "clicker-v1") manager.AddComponent<ClickerGame>();
            else if (runtime == "flappy-v1" || runtime == "breakout-v1" || runtime == "platformer-v1" || runtime == "tower-defense-v1" || runtime == "sokoban-v1" || runtime == "dialogue-v1") manager.AddComponent<ArcadeGame>();
            else if (runtime == "runner-v1") { manager.AddComponent<RunnerGameManager>(); manager.AddComponent<RunnerSceneBootstrap>(); }
            else throw new System.InvalidOperationException("GAME_RUNTIME_UNAVAILABLE");

            var cameraObject = new GameObject("Main Camera") { tag = "MainCamera" };
            cameraObject.transform.position = new Vector3(0f, 2f, -10f);
            var camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 5.5f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.16f, 0.3f, 0.52f);
            cameraObject.AddComponent<AudioListener>();

            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        }
    }
}

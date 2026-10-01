using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace GamerHub.AgentBridge.Editor
{
    // Entry points used by the production TypeScript adapter. Every entry
    // point emits one JSON envelope so stdout is machine-readable even when
    // Unity writes progress messages around it.
    public static class BatchmodeMethods
    {
        [Serializable]
        private sealed class Envelope
        {
            public string status;
            public string sessionId;
            public string artifactPath;
            public int passed;
            public int failed;
            public string[] changedFiles = Array.Empty<string>();
        }

        public static void Compile()
        {
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
            Emit(new Envelope { status = "succeeded" });
        }

        public static void RunTests()
        {
            throw new InvalidOperationException("TEST_RUNNER_REQUIRED: use Unity Test Framework -runTests and XML results");
        }

        public static void BuildWeb()
        {
            var outputPath = Argument("outputPath");
            if (string.IsNullOrWhiteSpace(outputPath))
                throw new InvalidOperationException("BUILD_OUTPUT_REQUIRED");
            var report = WebBuildCommand.Build(outputPath);
            var summary = report.summary;
            Emit(new Envelope
            {
                status = summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded ? "succeeded" : "failed",
                artifactPath = outputPath,
            });
        }

        public static void StartPlayMode()
        {
            throw new InvalidOperationException("COMMAND_NOT_IMPLEMENTED: persistent play sessions require an Editor transport");
        }

        public static void StopPlayMode()
        {
            throw new InvalidOperationException("COMMAND_NOT_IMPLEMENTED: persistent play sessions require an Editor transport");
        }

        public static void InspectProject()
        {
            throw new InvalidOperationException("COMMAND_NOT_IMPLEMENTED");
        }

        public static void EditScene()
        {
            throw new InvalidOperationException("COMMAND_NOT_IMPLEMENTED");
        }

        public static void ReadState()
        {
            throw new InvalidOperationException("COMMAND_NOT_IMPLEMENTED");
        }

        public static void ApplyParameter()
        {
            var assetPath = Argument("assetPath");
            var rawValue = Argument("value");
            var property = Argument("property");
            if (string.IsNullOrWhiteSpace(assetPath) || string.IsNullOrWhiteSpace(rawValue))
            {
                throw new InvalidOperationException("PARAMETER_ARGUMENT_REQUIRED");
            }
            if (property != "jumpVelocity" && property != "jump_height")
            {
                throw new InvalidOperationException("PARAMETER_NOT_SUPPORTED");
            }
            if (!float.TryParse(rawValue, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var value))
                throw new InvalidOperationException("PARAMETER_VALUE_INVALID");
            GameplayParameterCommands.SetJumpVelocity(assetPath, value);
            Emit(new Envelope { status = "succeeded", changedFiles = new[] { assetPath } });
        }

        public static void CreateScene()
        {
            var setupType = Type.GetType("GamerHub.Runner.Editor.RunnerSceneSetup, GamerHub.Runner.Editor");
            var ensure = setupType?.GetMethod("Ensure", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
            if (ensure == null) throw new InvalidOperationException("RUNNER_SCENE_SETUP_NOT_FOUND");
            ensure.Invoke(null, null);
            Emit(new Envelope { status = "succeeded", changedFiles = new[] { "Assets/Game/Scenes/Runner.unity" } });
        }
        public static void CreateGameObject() { throw new InvalidOperationException("COMMAND_NOT_IMPLEMENTED"); }
        public static void CreatePrefab() { throw new InvalidOperationException("COMMAND_NOT_IMPLEMENTED"); }
        public static void CreateScript() { throw new InvalidOperationException("COMMAND_NOT_IMPLEMENTED"); }
        public static void ImportAsset()
        {
            var assetPath = Argument("path");
            if (string.IsNullOrWhiteSpace(assetPath))
            {
                AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
                Emit(new Envelope { status = "succeeded" });
                return;
            }
            AssetImportCommands.ImportSprite(assetPath);
            Emit(new Envelope { status = "succeeded", changedFiles = new[] { assetPath } });
        }
        public static void CreateUi() { throw new InvalidOperationException("COMMAND_NOT_IMPLEMENTED"); }

        private static string Argument(string key)
        {
            var args = Environment.GetCommandLineArgs();
            var flag = "-gamerhub-" + key;
            for (var i = 0; i < args.Length - 1; i++)
                if (string.Equals(args[i], flag, StringComparison.Ordinal)) return args[i + 1];
            return string.Empty;
        }

        private static void Emit(Envelope envelope)
        {
            Console.WriteLine(JsonUtility.ToJson(envelope));
        }
    }
}

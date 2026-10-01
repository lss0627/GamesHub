using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;

namespace GamerHub.AgentBridge
{
    public static class WebBuildCommand
    {
        public const string Profile = "runner-web-v1";

        public static BuildReport Build(string outputPath)
        {
            AgentCommandRegistry.Demand("build.web");
            if (!outputPath.StartsWith("Builds/Web/", StringComparison.Ordinal) || outputPath.Contains(".."))
                throw new InvalidOperationException("WORKSPACE_ESCAPE: Web build path must be under Builds/Web");
            Directory.CreateDirectory(outputPath);
            EditorUserBuildSettings.development = false;
            EditorUserBuildSettings.connectProfiler = false;
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { "Assets/Game/Scenes/Runner.unity" },
                locationPathName = outputPath,
                target = BuildTarget.WebGL,
                options = BuildOptions.None,
            });
            if (report.summary.result == BuildResult.Succeeded)
            {
                var indexPath = Path.Combine(outputPath, "index.html");
                var html = File.ReadAllText(indexPath);
                html = html.Replace("</head>", "<style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#c8e6df}#unity-container.unity-desktop,#unity-container.unity-mobile{position:absolute;inset:0;width:100%;height:100%;transform:none}#unity-canvas{width:100%!important;height:100%!important;display:block}#unity-footer{display:none}</style></head>");
                File.WriteAllText(indexPath, html);
                foreach (var notice in new[] { "GameFont-LICENSE.txt", "GameFont-NOTICE.txt" })
                {
                    var source = Path.Combine("Assets/Resources/Art", notice);
                    if (File.Exists(source)) File.Copy(source, Path.Combine(outputPath, notice), true);
                }
            }
            return report;
        }
    }
}

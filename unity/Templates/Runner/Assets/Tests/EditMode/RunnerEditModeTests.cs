using NUnit.Framework;
using UnityEditor.SceneManagement;
using UnityEngine;
using GamerHub.Runner;
using System;

namespace GamerHub.Runner.Tests
{
    public class RunnerEditModeTests
    {
        [Test]
        public void RunnerSceneHasRequiredSystems()
        {
            var scene = EditorSceneManager.OpenScene("Assets/Game/Scenes/Runner.unity", OpenSceneMode.Single);
            Assert.That(scene.IsValid(), Is.True);
            var managerObject = Array.Find(scene.GetRootGameObjects(), item => item.name == "RunnerGameManager");
            Assert.That(managerObject, Is.Not.Null);
            Assert.That(managerObject.GetComponent<RunnerGameManager>(), Is.Not.Null);
            Assert.That(managerObject.GetComponent<RunnerSceneBootstrap>(), Is.Not.Null);
            Assert.That(Array.Exists(scene.GetRootGameObjects(), item => item.GetComponent<Camera>() != null), Is.True);
            Assert.That(RunnerGameConfig.Current.playerSpeed, Is.GreaterThan(0f));
            Assert.That(RunnerGameConfig.Current.specVersionId, Is.Not.Empty);
        }
    }
}

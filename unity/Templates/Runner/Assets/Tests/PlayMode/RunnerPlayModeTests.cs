using NUnit.Framework;
using UnityEngine.TestTools;
using System.Collections;
using GamerHub.Runner;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace GamerHub.Runner.Tests
{
    public class RunnerPlayModeTests
    {
        [UnityTest]
        public IEnumerator PauseFreezesClockAndBlocksJumpAndScore()
        {
            SceneManager.LoadScene("Runner");yield return null;yield return null;
            var manager=RunnerGameManager.Instance;manager.StartGame();manager.Pause();
            var before=manager.RemainingSeconds;manager.CollectCoin(10);
            Assert.IsFalse(GameObject.FindWithTag("Player").GetComponent<PlayerController>().TryJump());
            yield return new WaitForSecondsRealtime(.1f);
            Assert.AreEqual(before,manager.RemainingSeconds);Assert.AreEqual(0,manager.Score);
            manager.Pause();Assert.AreEqual(1,Time.timeScale);
        }
        [Test] public void ProjectTitleIsPreservedAndCommonChineseGlyphsExist() {
            const string name="蓝莓星球的奇妙冒险与守护者";
            Assert.AreEqual(name,GameCanvas.Title(name,"fallback"));
            var font=Resources.Load<Font>("Art/GameFont");
            foreach(char c in name)Assert.IsTrue(font.HasCharacter(c),"Missing "+c);
        }
        [UnityTest]
        public IEnumerator PlayerCanJumpAndLand()
        {
            SceneManager.LoadScene("Runner");
            yield return null;
            yield return null;
            var player = GameObject.FindWithTag("Player");
            Assert.That(player, Is.Not.Null);
            var controller = player.GetComponent<PlayerController>();
            Assert.That(controller, Is.Not.Null);
            Assert.That(controller.MoveSpeed, Is.EqualTo(RunnerGameConfig.Current.playerSpeed).Within(0.001f));
            Assert.That(controller.JumpVelocity, Is.EqualTo(RunnerGameConfig.Current.jumpVelocity).Within(0.001f));
            Assert.That(GameObject.Find("Coin"), Is.Not.Null);
            Assert.That(GameObject.Find("Obstacle"), Is.Not.Null);
            Assert.That(Resources.Load<Texture2D>("Art/cat"), Is.Not.Null);
            Assert.That(GameObject.Find("ForestBackground"), Is.Not.Null);
            RunnerGameManager.Instance.StartGame();
            yield return new WaitForSeconds(0.3f);
            var baseline = player.transform.position.y;
            Assert.That(controller.TryJump(), Is.True);
            Assert.That(player.GetComponent<Rigidbody2D>().linearVelocity.y, Is.GreaterThan(0));
            yield return new WaitForSeconds(0.2f);
            Assert.That(player.transform.position.y, Is.GreaterThan(baseline));
            yield return new WaitForSeconds(2.0f);
            Assert.That(player.transform.position.y, Is.EqualTo(baseline).Within(0.2f));
        }

        [UnityTest]
        public IEnumerator CoinAndObstacleUpdateGameState()
        {
            SceneManager.LoadScene("Runner");
            yield return null;
            yield return null;
            var manager = RunnerGameManager.Instance;
            Assert.That(manager, Is.Not.Null);
            var remaining = manager.RemainingSeconds;
            var obstacle = GameObject.Find("Obstacle");
            var originalPosition = obstacle.transform.position;
            yield return new WaitForSeconds(0.3f);
            Assert.That(manager.RemainingSeconds, Is.EqualTo(remaining));
            Assert.That(obstacle.transform.position, Is.EqualTo(originalPosition));
            Assert.That(GameObject.FindWithTag("Player").GetComponent<PlayerController>().TryJump(), Is.False);
            manager.StartGame();
            manager.CollectCoin(RunnerGameConfig.Current.scorePerCoin);
            Assert.That(manager.Coins, Is.EqualTo(1));
            Assert.That(manager.Score, Is.EqualTo(RunnerGameConfig.Current.scorePerCoin));
            manager.HitObstacle();
            Assert.That(manager.IsGameOver, Is.True);
            Assert.That(GameObject.FindWithTag("Player").GetComponent<PlayerController>().TryJump(), Is.False);
            manager.CollectCoin(10);
            Assert.That(manager.Coins, Is.EqualTo(1));
            var stoppedAt = obstacle.transform.position;
            var timeAtEnd = manager.RemainingSeconds;
            yield return new WaitForSeconds(0.3f);
            Assert.That(obstacle.transform.position, Is.EqualTo(stoppedAt));
            Assert.That(manager.RemainingSeconds, Is.EqualTo(timeAtEnd));
        }
    }
}

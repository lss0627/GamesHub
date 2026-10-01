using System.Collections;
using GamerHub.Runner;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

public sealed class ArenaPlayModeTests
{
    [Test] public void ChineseGameplayLabelsHaveBundledGlyphs() { var font=Resources.Load<Font>("Art/GameFont"); Assert.IsNotNull(font); foreach(char c in "幸存者升级伤害生命点击成长") Assert.IsTrue(font.HasCharacter(c),"Missing glyph: "+c); }
    private ArenaSimulation NewGame() => new ArenaSimulation(new RunnerGameConfigData { runtime = "arena-v1", genre = "survivor", maxHp = 5, damage = 2, enemyHp = 2, enemySpeed = 1, attackRange = 4, attackInterval = .5f, xpPerLevel = 1 });
    [Test] public void WaitingAndPauseDoNotAdvance() { var g=NewGame(); g.Step(1,Vector2.one,false); Assert.AreEqual(0,g.Elapsed); g.Start(); g.Pause(); g.Step(1,Vector2.one,false); Assert.AreEqual(0,g.Elapsed); }
    [Test] public void MovementIsNormalizedAndClamped() { var g=NewGame(); g.Start(); g.Step(.1f,Vector2.one,false); Assert.AreEqual(g.Config.playerSpeed*.1f,g.Player.magnitude,.001f); }
    [Test] public void EnemyChasesPlayer() { var g=NewGame(); g.Start(); var e=g.SpawnEnemy(new Vector2(8,0)); var before=e.Position.magnitude; g.Step(.1f,Vector2.zero,false); Assert.Less(e.Position.magnitude,before); }
    [Test] public void AutoAttackKillsAndDropsExperience() { var g=NewGame(); g.Start(); g.SpawnEnemy(new Vector2(3,0)); g.Step(.1f,Vector2.zero,false); Assert.AreEqual(1,g.Kills); Assert.AreEqual(1,g.Pickups.Count); }
    [Test] public void ManualShooterRequiresFire() { var c=new RunnerGameConfigData{runtime="arena-v1",genre="top_down_shooter",damage=2,enemyHp=2}; var g=new ArenaSimulation(c); g.Start(); g.SpawnEnemy(new Vector2(3,0)); g.Step(.1f,Vector2.zero,false); Assert.AreEqual(0,g.Attacks); g.Step(.1f,Vector2.zero,true); for(int i=0;i<10;i++)g.Step(.02f,Vector2.zero,false); Assert.AreEqual(1,g.Kills); }
    [Test] public void DirectedShotMissesEnemyOnOppositeSide() { var g=new ArenaSimulation(new RunnerGameConfigData{genre="top_down_shooter",enemySpeed=0,damage=10});g.Start();var enemy=g.SpawnEnemy(new Vector2(-3,0));g.Step(.01f,Vector2.zero,true,Vector2.right);for(int i=0;i<30;i++)g.Step(.02f,Vector2.zero,false,Vector2.right);Assert.Contains(enemy,g.Enemies);Assert.AreEqual(0,g.Hits);g.Step(.5f,Vector2.zero,true,Vector2.left);Assert.GreaterOrEqual(g.Hits,1); }
    [Test] public void PausingFreezesProjectiles() { var g=new ArenaSimulation(new RunnerGameConfigData{genre="top_down_shooter"});g.Start();g.Step(.01f,Vector2.zero,true,Vector2.right);Assert.Greater(g.Projectiles.Count,0);var point=g.Projectiles[0].Position;g.Pause();g.Step(1,Vector2.one,true,Vector2.left);Assert.AreEqual(point,g.Projectiles[0].Position); }
    [Test] public void MultishotUpgradeAddsProjectiles() { var g=NewGame();g.Start();g.SpawnEnemy(new Vector2(.9f,0));g.Step(.1f,Vector2.zero,false);Assert.AreEqual("upgrade",g.Phase);g.ChooseUpgrade(3);Assert.AreEqual(2,g.ProjectileCount); }
    [Test] public void PickupAndUpgradeChangeWeapon() { var g=NewGame(); g.Start(); g.SpawnEnemy(new Vector2(.9f,0)); g.Step(.1f,Vector2.zero,false); Assert.AreEqual("upgrade",g.Phase); var damage=g.Damage; g.ChooseUpgrade(0); Assert.Greater(g.Damage,damage); Assert.AreEqual(2,g.Level); Assert.AreEqual(0,g.Pickups.Count); }
    [Test] public void ContactDamageHasCooldownAndCanLose() { var g=NewGame(); g.Config.genre="top_down_shooter"; g.Start(); for(int i=0;i<8;i++)g.SpawnEnemy(Vector2.zero); g.Step(.01f,Vector2.zero,false); Assert.AreEqual(4,g.Health); g.Step(.01f,Vector2.zero,false); Assert.AreEqual(4,g.Health); for(int i=0;i<5;i++){g.SpawnEnemy(g.Player);g.Step(1,Vector2.zero,false);} Assert.AreEqual("lost",g.Phase); }
    [Test] public void VictoryAndRestartResetState() { var g=NewGame();g.Config.enemySpeed=0; g.Start(); g.Step(g.Config.levelDurationSeconds+.01f,Vector2.zero,false); Assert.AreEqual("won",g.Phase); g.Start(); Assert.AreEqual(0,g.Elapsed); Assert.AreEqual(1,g.Level); Assert.AreEqual(0,g.Kills); }
    [UnityTest] public IEnumerator MonoBehaviourAdvancesTheActualSimulation() { var o=new GameObject("arena-test"); var g=o.AddComponent<ArenaGame>(); yield return null; g.Game.Start(); yield return new WaitForSeconds(.1f); Assert.Greater(g.Game.Elapsed,0); Object.Destroy(o); }
}


using GamerHub.Runner;
using NUnit.Framework;
using UnityEngine;

public sealed class FlappyPlayModeTests {
    [Test] public void EighthGateWinsAndRestartClearsProgress() {var g=new FlappySimulation(new RunnerGameConfigData());g.Start();for(int i=0;i<8;i++)g.Gates.Add(new FlappySimulation.Gate{X=3.9f,Center=5});g.Step(.01f,0,false);Assert.AreEqual("won",g.Phase);g.Start();Assert.AreEqual(0,g.Score);Assert.AreEqual(0,g.Gates.Count);}
    [Test] public void FlapRaisesPlayerAndFallingLoses() { var g=new FlappySimulation(new RunnerGameConfigData());g.Start();var y=g.Player.y;g.Step(.1f,0,true);Assert.Greater(g.Player.y,y);g.Step(10,0,false);Assert.AreEqual("lost",g.Phase); }
    [Test] public void PassingGateScoresAndPauseFreezes() { var g=new FlappySimulation(new RunnerGameConfigData());g.Start();g.Gates.Add(new FlappySimulation.Gate{X=3.9f,Center=5});g.Step(.01f,0,false);Assert.AreEqual(1,g.Score);g.Pause();var p=g.Player;g.Step(2,0,true);Assert.AreEqual(p,g.Player); }
}
public sealed class BreakoutPlayModeTests {
    [Test] public void BallBreaksBrickAndCompletesBoard() { var g=new BreakoutSimulation(new RunnerGameConfigData());g.Start();g.Bricks.Clear();g.Bricks.Add(new Vector2(10,6));g.Ball=new Vector2(10,5.5f);g.Velocity=Vector2.up*6;g.Step(.1f,0,false);Assert.AreEqual(1,g.Score);Assert.AreEqual("won",g.Phase); }
    [Test] public void MissingPaddleCostsLifeAndPauseFreezes() { var g=new BreakoutSimulation(new RunnerGameConfigData{maxHp=1});g.Start();g.Ball=new Vector2(2,-1);g.Velocity=Vector2.down;g.Step(.02f,0,false);Assert.AreEqual("lost",g.Phase);g.Start();g.Pause();var x=g.Paddle;g.Step(1,1,true);Assert.AreEqual(x,g.Paddle); }
}
public sealed class PlatformerPlayModeTests {
    [Test] public void JumpMovesAcrossPlatformsAndCheckpointPersistsAfterFall() { var g=new PlatformerSimulation(new RunnerGameConfigData{jumpVelocity=7});g.Start();g.Step(.1f,1,true);Assert.Greater(g.Player.x,1);Assert.Greater(g.Player.y,1);g.Start();g.Player=new Vector2(14,1);g.Step(.01f,0,false);Assert.Greater(g.Checkpoint,1);g.Player=new Vector2(9,-3);g.Step(.01f,0,false);Assert.AreEqual(g.Checkpoint,g.Player.x,.01f); }
    [Test] public void ExitWinsAndFinalFallLoses() { var g=new PlatformerSimulation(new RunnerGameConfigData{maxHp=1});g.Start();g.Player=new Vector2(43,1);g.Step(.01f,0,false);Assert.AreEqual("won",g.Phase);g.Start();g.Player=new Vector2(9,-3);g.Step(.01f,0,false);Assert.AreEqual("lost",g.Phase); }
}
public sealed class TowerDefensePlayModeTests {
    [Test] public void FiveDefendedWavesWinAndRestartResetsEconomy() {var g=new TowerDefenseSimulation(new RunnerGameConfigData{damage=4,attackInterval=.2f,enemyHp=2,levelDurationSeconds=180});g.Start();g.Build(0);g.Build(1);g.Build(2);for(int i=0;i<9000&&g.Phase=="playing";i++){g.Step(.02f,0,false);for(int cell=0;cell<6;cell++)g.Build(cell);}Assert.AreEqual("won",g.Phase);Assert.AreEqual(5,g.Wave);g.Start();Assert.AreEqual(100,g.Currency);Assert.AreEqual(0,g.Towers.Count);}
    [Test] public void BuildingCostsCurrencyAndTowersDamageActualEnemies() { var g=new TowerDefenseSimulation(new RunnerGameConfigData{damage=2,enemyHp=2});g.Start();Assert.IsTrue(g.Build(0));Assert.AreEqual(70,g.Currency);g.Enemies.Add(new TowerDefenseSimulation.Invader{Position=new Vector2(3,5),Hp=2,Next=1});g.Step(.1f,0,false);Assert.Greater(g.Kills,0); }
    [Test] public void EnemiesReachingExitDamageBaseAndCanLose() { var g=new TowerDefenseSimulation(new RunnerGameConfigData{maxHp=1});g.Start();g.Enemies.Add(new TowerDefenseSimulation.Invader{Position=new Vector2(21,7),Hp=2,Next=5});g.Step(.1f,0,false);Assert.AreEqual("lost",g.Phase); }
}
public sealed class PuzzlePlayModeTests {
    [Test] public void BoardCanBeSolvedThroughLegalMovesAndDeadlineLoses() {var g=new PuzzleSimulation(new RunnerGameConfigData());g.Start();foreach(var move in "LUURDRRU"){Assert.IsTrue(g.Move(move=='L'?-1:move=='R'?1:0,move=='U'?1:move=='D'?-1:0));}Assert.AreEqual("won",g.Phase);Assert.IsTrue(g.Undo());Assert.AreEqual("playing",g.Phase);g.Start();g.Step(61,0,false);Assert.AreEqual("lost",g.Phase);}
    [Test] public void PushMovesBoxAndUndoRestoresState() { var g=new PuzzleSimulation(new RunnerGameConfigData());g.Start();var player=g.Player;Assert.IsTrue(g.Move(1,0));Assert.IsTrue(g.Move(0,1));Assert.IsTrue(g.Boxes.Contains(new Vector2Int(4,2)));Assert.IsTrue(g.Undo());Assert.AreEqual(new Vector2Int(4,4),g.Player);Assert.IsTrue(g.Boxes.Contains(new Vector2Int(4,3))); }
    [Test] public void WallsBlockAndRestartResetsMoves() { var g=new PuzzleSimulation(new RunnerGameConfigData());g.Start();for(int i=0;i<8;i++)g.Move(-1,0);Assert.AreEqual(1,g.Player.x);g.Start();Assert.AreEqual(0,g.Score);Assert.AreEqual(new Vector2Int(3,4),g.Player); }
}
public sealed class DialoguePlayModeTests {
    [Test] public void ChoicesCarryKeyToGoodEnding() { var g=new DialogueSimulation(new RunnerGameConfigData());g.Start();g.Choose(0);g.Choose(0);Assert.IsTrue(g.HasKey);g.Choose(1);g.Choose(0);Assert.AreEqual("won",g.Phase); }
    [Test] public void RiskyChoiceCanLoseAndRestartClearsInventory() { var g=new DialogueSimulation(new RunnerGameConfigData());g.Start();g.Choose(1);g.Choose(1);Assert.AreEqual("lost",g.Phase);g.Start();Assert.IsFalse(g.HasKey);Assert.AreEqual(0,g.Node); }
}


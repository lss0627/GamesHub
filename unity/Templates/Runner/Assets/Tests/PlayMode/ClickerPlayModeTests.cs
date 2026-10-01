using GamerHub.Runner;
using NUnit.Framework;
public sealed class ClickerPlayModeTests
{
    [Test] public void WaitingDoesNotEarn() { var g=new ClickerSimulation(new RunnerGameConfigData());g.Click();g.Step(1);Assert.AreEqual(0,g.Total); }
    [Test] public void BuyingUpgradeCostsResourcesAndImprovesIncome() { var g=new ClickerSimulation(new RunnerGameConfigData { scorePerCoin=10,upgradeCost=20,goal=500 });g.Start();g.Click();g.Click();Assert.IsTrue(g.Buy());Assert.AreEqual(0,g.Wallet);Assert.Greater(g.PerClick,10);Assert.Greater(g.AutoIncome,0);g.Step(1);Assert.Greater(g.Total,20); }
    [Test] public void InsufficientFundsCannotBuy() { var g=new ClickerSimulation(new RunnerGameConfigData());g.Start();Assert.IsFalse(g.Buy());Assert.AreEqual(1,g.Level); }
    [Test] public void GoalAndTimeoutAndRestart() { var g=new ClickerSimulation(new RunnerGameConfigData{scorePerCoin=10,goal=20});g.Start();g.Click();g.Click();Assert.AreEqual("won",g.Phase);g.Start();Assert.AreEqual(0,g.Total);g.Step(1000);Assert.AreEqual("lost",g.Phase); }
    [Test] public void OversizedFrameDoesNotEarnBeyondDeadline() { var g=new ClickerSimulation(new RunnerGameConfigData{autoIncome=1,goal=50,levelDurationSeconds=30});g.Start();g.Step(60);Assert.AreEqual(30,g.Total,.001f);Assert.AreEqual(30,g.Elapsed,.001f);Assert.AreEqual("lost",g.Phase); }
    [Test] public void ExactDeadlineCanWinButFinishedStateCannotEarn() { var g=new ClickerSimulation(new RunnerGameConfigData{autoIncome=2,goal=60,levelDurationSeconds=30});g.Start();g.Step(100);Assert.AreEqual("won",g.Phase);Assert.AreEqual(60,g.Total,.001f);g.Click();g.Step(5);Assert.AreEqual(60,g.Total,.001f); }
    [Test] public void PausedEconomyAndInvalidTimeAreFrozen() { var g=new ClickerSimulation(new RunnerGameConfigData{autoIncome=2});g.Start();g.Pause();g.Step(5);g.Click();Assert.AreEqual(0,g.Total);g.Pause();g.Step(float.NaN);g.Step(float.PositiveInfinity);Assert.AreEqual(0,g.Elapsed); }
}

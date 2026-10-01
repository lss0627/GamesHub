using UnityEngine;
namespace GamerHub.Runner
{
    public sealed class ClickerSimulation
    {
        public readonly RunnerGameConfigData Config;
        public string Phase { get; private set; }="ready";
        public float Total { get; private set; }
        public float Wallet { get; private set; }
        public float Elapsed { get; private set; }
        public int Level { get; private set; }=1;
        public int PerClick { get; private set; }
        public int AutoIncome { get; private set; }
        public int Cost => Mathf.RoundToInt(Config.upgradeCost*Mathf.Pow(1.5f,Level-1));
        public ClickerSimulation(RunnerGameConfigData config) { Config=config;PerClick=config.scorePerCoin;AutoIncome=config.autoIncome; }
        public void Start() { Phase="playing";Total=Wallet=Elapsed=0;Level=1;PerClick=Config.scorePerCoin;AutoIncome=Config.autoIncome; }
        public void Pause() { if(Phase=="playing")Phase="paused";else if(Phase=="paused")Phase="playing"; }
        private void Earn(float amount) { Total+=amount;Wallet+=amount;if(Total>=Config.goal)Phase="won"; }
        public void Click() { if(Phase=="playing")Earn(PerClick); }
        public bool Buy() { if(Phase!="playing" || Wallet<Cost)return false;Wallet-=Cost;Level++;PerClick+=Config.scorePerCoin;AutoIncome+=2;return true; }
        public void Step(float delta) {
            if(Phase!="playing" || delta<=0 || float.IsNaN(delta) || float.IsInfinity(delta))return;
            var valid=Mathf.Min(delta,Mathf.Max(0,Config.levelDurationSeconds-Elapsed));
            Elapsed+=valid; Earn(AutoIncome*valid);
            if(Phase=="playing" && Elapsed>=Config.levelDurationSeconds)Phase="lost";
        }
    }
}

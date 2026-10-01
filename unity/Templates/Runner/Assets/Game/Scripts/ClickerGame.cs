using UnityEngine;
namespace GamerHub.Runner
{
    public sealed class ClickerGame : MonoBehaviour
    {
        public ClickerSimulation Game { get; private set; }
        private Texture2D coin,hero,background;
        private float reportAt;
        private void Awake() { Game=new ClickerSimulation(RunnerGameConfig.Current);coin=Resources.Load<Texture2D>("Art/coin");hero=Resources.Load<Texture2D>("Art/cat");background=Resources.Load<Texture2D>("Art/forest"); }
        private void Update() { Game.Step(Time.deltaTime);if(Time.realtimeSinceStartup>=reportAt){reportAt=Time.realtimeSinceStartup+.1f;GameStateReporter.Report(new PublicGameState{runtime="clicker-v1",genre="clicker",specVersionId=Game.Config.specVersionId,phase=Game.Phase,total=Game.Total,wallet=Game.Wallet,perClick=Game.PerClick,autoIncome=Game.AutoIncome,level=Game.Level,elapsed=Game.Elapsed});} }
        private void OnGUI() {
            if(Game==null)return;GameCanvas.Begin();GameCanvas.Fill(new Rect(0,0,960,600),new Color(.06f,.17f,.18f));
            if(background!=null){GUI.color=new Color(.6f,.7f,.7f,.35f);GUI.DrawTexture(new Rect(0,0,960,600),background,ScaleMode.ScaleAndCrop);GUI.color=Color.white;}
            GameCanvas.Text(new Rect(45,20,620,48),GameCanvas.Title(Game.Config.gameName,"点击成长工坊"),28);GameCanvas.Text(new Rect(700,20,230,48),$"剩余 {Mathf.CeilToInt(Game.Config.levelDurationSeconds-Game.Elapsed)}秒",22);
            GameCanvas.Fill(new Rect(35,94,890,80),new Color(.05f,.12f,.15f,.85f));GameCanvas.Text(new Rect(65,107,830,52),$"资源总量 {Game.Total:0}/{Game.Config.goal}    钱包 {Game.Wallet:0}    等级 {Game.Level}",24);
            GameCanvas.Sprite(hero,new Vector2(230,318),190);GameCanvas.Sprite(coin,new Vector2(510,286),100);
            GameCanvas.Text(new Rect(630,220,265,100),$"每次点击 +{Game.PerClick}\n自动每秒 +{Game.AutoIncome}\n升级价格 {Game.Cost}",22);
            GUI.enabled=Game.Phase=="playing";
            if(GameCanvas.Button(new Rect(387,377,245,68),$"收集 +{Game.PerClick}"))Game.Click();
            GUI.enabled=Game.Phase=="playing" && Game.Wallet>=Game.Cost; if(GameCanvas.Button(new Rect(660,377,230,68),Game.Wallet>=Game.Cost?"购买强化":$"还差 {Mathf.CeilToInt(Game.Cost-Game.Wallet)}"))Game.Buy(); GUI.enabled=true;
            GameCanvas.Text(new Rect(58,503,690,60),"收集能量、购买工具、提高收益。\n在时间结束前达到目标。",20);
            GUI.enabled=Game.Phase=="playing" || Game.Phase=="paused";
            if(GameCanvas.Button(new Rect(785,518,130,38),Game.Phase=="paused"?"继续":"暂停"))Game.Pause();
            GUI.enabled=true;
            if(Game.Phase=="ready" || Game.Phase=="won" || Game.Phase=="lost") {
                GameCanvas.Fill(new Rect(235,150,490,385),new Color(.04f,.1f,.14f,.97f));GameCanvas.Text(new Rect(270,212,430,65),Game.Phase=="ready"?"建造你的能量工坊":Game.Phase=="won"?"目标达成！":"时间到了，再试一次",26);
                GameCanvas.Text(new Rect(270,284,420,65),"点击获得资源，购买强化后，每次点击和自动收益都会提高。",21);
                if(GameCanvas.Button(new Rect(345,455,270,56),Game.Phase=="ready"?"开始游戏":"重新挑战"))Game.Start();
            }
            GameCanvas.End();
        }
    }
}

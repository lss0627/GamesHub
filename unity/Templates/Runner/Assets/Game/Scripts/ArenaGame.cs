using UnityEngine;

namespace GamerHub.Runner
{
    public sealed class ArenaGame : MonoBehaviour
    {
        public ArenaSimulation Game { get; private set; }
        private Texture2D hero,enemy,orb,background;
        private Vector2 touch;
        private bool touchFire;
        private Vector2 aim=Vector2.right;
        private float reportAt;
        private void Awake() {
            Game=new ArenaSimulation(RunnerGameConfig.Current);
            hero=Resources.Load<Texture2D>("Art/cat");enemy=Resources.Load<Texture2D>("Art/stump");orb=Resources.Load<Texture2D>("Art/coin");background=Resources.Load<Texture2D>("Art/forest");
        }
        private void Update() {
            if(Input.GetKeyDown(KeyCode.P)) Game.Pause();
            var pointer=new Vector2(Input.mousePosition.x*960/Screen.width,600-Input.mousePosition.y*600/Screen.height);
            var onField=pointer.y>85 && pointer.y<515;
            if(onField)aim=GameCanvas.WorldPoint(pointer)-Game.Player;
            else if(touch.sqrMagnitude>.01f)aim=touch;
            Game.Step(Time.deltaTime,new Vector2(Input.GetAxisRaw("Horizontal"),Input.GetAxisRaw("Vertical"))+touch,Input.GetKey(KeyCode.Space)||touchFire||(onField&&Input.GetMouseButton(0)),aim);
            if(Time.realtimeSinceStartup>=reportAt) { reportAt=Time.realtimeSinceStartup+.1f;GameStateReporter.Report(Snapshot()); }
        }
        public PublicGameState Snapshot() => new PublicGameState {
            runtime="arena-v1",genre=Game.Config.genre,specVersionId=Game.Config.specVersionId,phase=Game.Phase,
            x=Game.Player.x,y=Game.Player.y,elapsed=Game.Elapsed,health=Game.Health,kills=Game.Kills,attacks=Game.Attacks,hits=Game.Hits,xp=Game.Xp,level=Game.Level,
            damage=Game.Damage,cooldown=Game.Cooldown,tick=Game.Tick,pickups=Game.Pickups.Count,enemies=Game.Enemies.Count,
            xpX=Game.Pickups.Count>0?Game.Pickups[0].x:0,xpY=Game.Pickups.Count>0?Game.Pickups[0].y:0
        };
        private void OnGUI() {
            if(Game==null)return;GameCanvas.Begin();
            GameCanvas.Fill(new Rect(0,0,960,600),new Color(.055f,.12f,.16f));
            if(background!=null){GUI.color=new Color(.32f,.46f,.52f,.5f);GUI.DrawTexture(new Rect(0,75,960,455),background,ScaleMode.ScaleAndCrop);GUI.color=Color.white;}
            for(int x=0;x<24;x++)GameCanvas.Fill(new Rect(x*40,85,1,430),new Color(.2f,.34f,.35f,.18f));
            for(int y=0;y<11;y++)GameCanvas.Fill(new Rect(30,85+y*40,900,1),new Color(.2f,.34f,.35f,.18f));
            GameCanvas.Text(new Rect(24,12,360,28),GameCanvas.Title(Game.Config.gameName,Game.Config.genre=="survivor"?"幸存者":"俯视射击"),24);
            GameCanvas.Text(new Rect(24,42,560,25),$"生命 {Game.Health}/{Game.Config.maxHp}     等级 {Game.Level}     经验 {Game.Xp}/{Game.Config.xpPerLevel}",17);
            GameCanvas.Text(new Rect(675,12,250,28),$"{Mathf.CeilToInt(Game.Config.levelDurationSeconds-Game.Elapsed)}秒    击败 {Game.Kills}",21);
            if(GameCanvas.Button(new Rect(816,44,118,28),Game.Phase=="paused"?"继续":"暂停"))Game.Pause();
            foreach(var pickup in Game.Pickups)GameCanvas.Sprite(orb,GameCanvas.ScreenPoint(pickup),25,new Color(.55f,1,1));
            foreach(var opponent in Game.Enemies) { var p=GameCanvas.ScreenPoint(opponent.Position);GameCanvas.Sprite(enemy,p,opponent.Kind==2?66:opponent.Kind==1?40:52,opponent.Kind==1?new Color(1,.8f,.3f):opponent.Kind==2?new Color(.65f,.55f,1):new Color(1,.6f,.75f));GameCanvas.Fill(new Rect(p.x-18,p.y-33,36f*opponent.Hp/(Game.Config.enemyHp*(opponent.Kind==2?2:1)),3),new Color(1,.45f,.5f)); }
            foreach(var shot in Game.Projectiles)GameCanvas.Sprite(orb,GameCanvas.ScreenPoint(shot.Position),12,new Color(.65f,1,1));
            var player=GameCanvas.ScreenPoint(Game.Player);GameCanvas.Sprite(hero,player,66);
            if(Game.Config.genre=="top_down_shooter")GameCanvas.Sprite(orb,GameCanvas.ScreenPoint(Game.Player+Game.Aim*.9f),8,Color.white);
            if(Game.Flash>0) { var target=GameCanvas.ScreenPoint(Game.LastTarget); var old=GUI.matrix;var angle=Mathf.Atan2(target.y-player.y,target.x-player.x)*Mathf.Rad2Deg;GUIUtility.RotateAroundPivot(angle,player);GameCanvas.Fill(new Rect(player.x,player.y-2,Vector2.Distance(player,target),4),new Color(.6f,1,1));GUI.matrix=old; }
            GameCanvas.Fill(new Rect(0,530,960,70),new Color(.045f,.09f,.13f));
            GameCanvas.Text(new Rect(22,543,560,42),"WASD / 方向键移动 · 靠近拾取经验\n"+(Game.Config.genre=="survivor"?"武器会自动攻击":"鼠标瞄准，按住左键或空格射击；触屏点场地瞄准射击"),16);
            touch=Vector2.zero;var style=new GUIStyle(GUI.skin.button){fontSize=20};
            if(GUI.RepeatButton(new Rect(615,544,44,38),"<",style))touch.x=-1;
            if(GUI.RepeatButton(new Rect(711,544,44,38),">",style))touch.x=1;
            if(GUI.RepeatButton(new Rect(663,534,44,25),"^",style))touch.y=1;
            if(GUI.RepeatButton(new Rect(663,564,44,25),"v",style))touch.y=-1;
            touchFire=Game.Config.genre=="top_down_shooter" && GUI.RepeatButton(new Rect(800,544,130,38),"射击",style);
            if(Game.Phase!="playing") {
                GameCanvas.Fill(new Rect(170,135,620,340),new Color(.045f,.09f,.13f,.97f));
                if(Game.Phase=="upgrade") {
                    GameCanvas.Text(new Rect(210,158,540,40),"升级了，选择你的强化",25);
                    GameCanvas.Text(new Rect(210,210,540,42),"战斗已暂停，慢慢决定。",19);
                    if(GameCanvas.Button(new Rect(205,268,260,74),"力量 · 伤害 +1"))Game.ChooseUpgrade(0);
                    if(GameCanvas.Button(new Rect(495,268,260,74),"急速 · 攻击间隔 -20%"))Game.ChooseUpgrade(1);
                    if(GameCanvas.Button(new Rect(205,357,260,74),"恢复 · 生命 +2"))Game.ChooseUpgrade(2);
                    GUI.enabled=Game.ProjectileCount<5;
                    if(Game.Config.upgradeChoicesCount>=4 && GameCanvas.Button(new Rect(495,357,260,74),"扩散 · 额外攻击 +1"))Game.ChooseUpgrade(3);
                    GUI.enabled=true;
                } else if(Game.Phase=="paused") {
                    GameCanvas.Text(new Rect(235,205,500,50),"已暂停",32);
                    if(GameCanvas.Button(new Rect(345,340,270,56),"继续游戏"))Game.Pause();
                } else {
                    GameCanvas.Text(new Rect(215,166,545,45),Game.Phase=="ready"?"移动 · 生存 · 成长":Game.Phase=="won"?"你成功活下来了！":"再试一次？",30);
                    GameCanvas.Text(new Rect(215,225,535,100),Game.Phase=="ready"?"走位躲开敌人，击败后靠近收集经验。升级时选择强化，坚持到倒计时结束即可通关。":$"击败 {Game.Kills}   等级 {Game.Level}   时间 {Game.Elapsed:0}秒\n再试试不同的强化组合。",21);
                    if(GameCanvas.Button(new Rect(345,365,270,56),Game.Phase=="ready"?"开始游戏":"重新挑战"))Game.Start();
                }
            }
            GameCanvas.End();
        }
    }
}

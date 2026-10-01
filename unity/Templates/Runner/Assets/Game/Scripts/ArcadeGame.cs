using UnityEngine;
namespace GamerHub.Runner
{
    // Shared presentation only; each preset owns its state machine and rules.
    public sealed class ArcadeGame : MonoBehaviour
    {
        public PrototypeSession Game { get; private set; }
        private Texture2D hero,coin;
        private float touchAxis,reportAt;
        private bool pendingAction;
        private float cameraX;
        private string Instructions => Game is FlappySimulation?"空格 / 点击飞跃：穿过 8 道门，避开上下边界。":Game is BreakoutSimulation?"左右移动挡板，空格发球；击碎全部砖块。":Game is PlatformerSimulation?"左右移动、空格跳跃；越过深坑，经过旗帜可存下检查点，到达终点。":Game is TowerDefenseSimulation?"点击空位建塔（30），再次点击升级。守住基地，完成 5 波防守。":Game is PuzzleSimulation?"方向键推箱子，把 3 个箱子移到金色目标上；走错可以撤销。":"选择行动，帮助伙伴、收集钥匙，寻找星灯。不同选择会改变结局。";
        private void Awake() {
            var c=RunnerGameConfig.Current;
            switch(c.genre){case "flappy":Game=new FlappySimulation(c);break;case "breakout":Game=new BreakoutSimulation(c);break;case "platformer":Game=new PlatformerSimulation(c);break;case "tower_defense":Game=new TowerDefenseSimulation(c);break;case "puzzle":Game=new PuzzleSimulation(c);break;case "rpg_dialogue":Game=new DialogueSimulation(c);break;default:throw new System.InvalidOperationException("GAME_RUNTIME_UNAVAILABLE");}
            hero=Resources.Load<Texture2D>("Art/cat");coin=Resources.Load<Texture2D>("Art/coin");
        }
        private void Update(){
            if(Input.GetKeyDown(KeyCode.P)||Input.GetKeyDown(KeyCode.Escape))Game.Pause();
            if(Game is PuzzleSimulation puzzle){if(Input.GetKeyDown(KeyCode.LeftArrow)||Input.GetKeyDown(KeyCode.A))puzzle.Move(-1,0);if(Input.GetKeyDown(KeyCode.RightArrow)||Input.GetKeyDown(KeyCode.D))puzzle.Move(1,0);if(Input.GetKeyDown(KeyCode.UpArrow)||Input.GetKeyDown(KeyCode.W))puzzle.Move(0,1);if(Input.GetKeyDown(KeyCode.DownArrow)||Input.GetKeyDown(KeyCode.S))puzzle.Move(0,-1);if(Input.GetKeyDown(KeyCode.Z))puzzle.Undo();}
            Game.Step(Time.deltaTime,Mathf.Clamp(Input.GetAxisRaw("Horizontal")+touchAxis,-1,1),pendingAction||Input.GetKeyDown(KeyCode.Space));pendingAction=false;
            if(Time.realtimeSinceStartup>=reportAt){reportAt=Time.realtimeSinceStartup+.1f;var position=Game is FlappySimulation f?f.Player:Game is PlatformerSimulation p?p.Player:Game is BreakoutSimulation b?b.Ball:Game is PuzzleSimulation s?(Vector2)s.Player:Vector2.zero;GameStateReporter.Report(new ArcadePublicState{runtime=Game.Config.runtime,genre=Game.Config.genre,specVersionId=Game.Config.specVersionId,phase=Game.Phase,elapsed=Game.Elapsed,score=Game.Score,health=Game.Health,x=position.x,y=position.y,board=Game is PuzzleSimulation box?box.Board():"",wave=Game is TowerDefenseSimulation td?td.Wave:0,currency=Game is TowerDefenseSimulation tower?tower.Currency:0,node=Game is DialogueSimulation d?d.Node:0,hasKey=Game is DialogueSimulation dialogue&&dialogue.HasKey});}
        }
        private Vector2 Point(Vector2 p)=>new Vector2(40+(p.x-cameraX)*40,490-p.y*38);
        private void Block(Vector2 p,float w,float h,Color color){var at=Point(p);GameCanvas.Fill(new Rect(at.x-w*20,at.y-h*19,w*40,h*38),color);}
        private void Playfield(){
            cameraX=Game is PlatformerSimulation platform?Mathf.Clamp(platform.Player.x-6,0,23):0;
            GameCanvas.Fill(new Rect(25,100,910,398),new Color(.07f,.16f,.21f));
            if(Game is FlappySimulation flappy){foreach(var gate in flappy.Gates){Block(new Vector2(gate.X,(gate.Center-1.7f)/2),.8f,gate.Center-1.7f,new Color(.3f,.64f,.5f));Block(new Vector2(gate.X,(gate.Center+1.7f+10)/2),.8f,10-gate.Center-1.7f,new Color(.3f,.64f,.5f));}GameCanvas.Sprite(hero,Point(flappy.Player),36);}
            else if(Game is BreakoutSimulation breakout){foreach(var brick in breakout.Bricks)Block(brick,2,.55f,new Color(.85f,.55f,.32f));Block(new Vector2(breakout.Paddle,.8f),3.2f,.3f,Color.cyan);Block(breakout.Ball,.4f,.4f,Color.white);}
            else if(Game is PlatformerSimulation jumper){for(int i=0;i<45;i++)if(!PlatformerSimulation.IsPit(i+.5f))Block(new Vector2(i+.5f,.2f),1,.7f,new Color(.3f,.48f,.39f));foreach(var pickup in jumper.Coins)if(pickup.x>=cameraX&&pickup.x<=cameraX+22)GameCanvas.Sprite(coin,Point(pickup),23);foreach(var flag in new[]{13,26,43})if(flag>=cameraX&&flag<cameraX+22){Block(new Vector2(flag,1.7f),.1f,2,new Color(.9f,.85f,.6f));Block(new Vector2(flag+.35f,2.5f),.7f,.5f,flag==43?Color.yellow:Color.cyan);}GameCanvas.Sprite(hero,Point(jumper.Player),38);}
            else if(Game is TowerDefenseSimulation defense){for(int i=1;i<TowerDefenseSimulation.Route.Length;i++){var a=TowerDefenseSimulation.Route[i-1];var b=TowerDefenseSimulation.Route[i];for(float t=0;t<1;t+=.02f)Block(Vector2.Lerp(a,b,t),.8f,.8f,new Color(.37f,.32f,.25f));}foreach(var enemy in defense.Enemies)Block(enemy.Position,.55f,.55f,new Color(.9f,.35f,.34f));for(int i=0;i<TowerDefenseSimulation.Sites.Length;i++){var at=Point(TowerDefenseSimulation.Sites[i]);var tower=defense.Towers.Find(t=>t.Cell==i);GUI.enabled=Game.Phase=="playing";if(GameCanvas.Button(new Rect(at.x-35,at.y-22,70,44),tower==null?"+ 30":tower.Level>=3?"满级":$"Lv{tower.Level}"))defense.Build(i);GUI.enabled=true;}GameCanvas.Text(new Rect(60,106,800,30),$"第 {defense.Wave}/5 波    金币 {defense.Currency}    击败 {defense.Kills}",19);}
            else if(Game is PuzzleSimulation puzzle){for(int y=0;y<PuzzleSimulation.Map.Length;y++)for(int x=0;x<PuzzleSimulation.Map[y].Length;x++){var cell=new Vector2Int(x,y);var rect=new Rect(240+x*60,113+y*60,56,56);GameCanvas.Fill(rect,PuzzleSimulation.Map[y][x]=='#'?new Color(.27f,.38f,.43f):puzzle.Goals.Contains(cell)?new Color(.65f,.54f,.23f):new Color(.1f,.22f,.25f));if(puzzle.Boxes.Contains(cell)){GameCanvas.Fill(new Rect(rect.x+8,rect.y+8,40,40),puzzle.Goals.Contains(cell)?new Color(.35f,.8f,.55f):new Color(.76f,.45f,.25f));GameCanvas.Text(new Rect(rect.x+18,rect.y+10,30,30),"箱",19);}if(puzzle.Player==cell)GameCanvas.Sprite(hero,rect.center,44);}}
            else if(Game is DialogueSimulation story){GameCanvas.Sprite(hero,new Vector2(150,290),125);GameCanvas.Text(new Rect(285,150,590,130),story.Text,25);GameCanvas.Text(new Rect(290,287,550,35),story.HasKey?"行囊：星形钥匙":"行囊：空",18);for(int i=0;i<story.Choices.Length;i++){GUI.enabled=Game.Phase=="playing";if(GameCanvas.Button(new Rect(285,335+i*65,580,52),story.Choices[i]))story.Choose(i);GUI.enabled=true;}}
        }
        private void OnGUI(){if(Game==null)return;GameCanvas.Begin();GameCanvas.Fill(new Rect(0,0,960,600),new Color(.04f,.1f,.15f));GameCanvas.Text(new Rect(32,15,660,43),GameCanvas.Title(Game.Config.gameName,"奇妙冒险"),27);GameCanvas.Text(new Rect(710,20,230,38),$"剩余 {Mathf.Max(0,Mathf.CeilToInt(Game.Config.levelDurationSeconds-Game.Elapsed))} 秒",20);GameCanvas.Text(new Rect(35,58,860,36),Game is PuzzleSimulation?$"步数 {Game.Score} · Z 撤销":$"得分 {Game.Score} · 生命 {Game.Health}",18);Playfield();
            GUI.enabled=Game.Phase=="playing";
            touchAxis=0;
            if(Game is PuzzleSimulation puzzle){if(GameCanvas.Button(new Rect(25,515,65,52),"←"))puzzle.Move(-1,0);if(GameCanvas.Button(new Rect(95,515,65,52),"↑"))puzzle.Move(0,1);if(GameCanvas.Button(new Rect(165,515,65,52),"↓"))puzzle.Move(0,-1);if(GameCanvas.Button(new Rect(235,515,65,52),"→"))puzzle.Move(1,0);if(GameCanvas.Button(new Rect(315,515,115,52),"撤销"))puzzle.Undo();}
            else if(Game is BreakoutSimulation||Game is PlatformerSimulation){if(GUI.RepeatButton(new Rect(30,515,90,55),"◀"))touchAxis=-1;if(GUI.RepeatButton(new Rect(130,515,90,55),"▶"))touchAxis=1;if(GameCanvas.Button(new Rect(570,515,175,55),Game is BreakoutSimulation?"发球 / 空格":"跳跃 / 空格"))pendingAction=true;}
            else if(Game is FlappySimulation){if(GameCanvas.Button(new Rect(270,515,420,55),"飞跃 / 空格"))pendingAction=true;}
            else GameCanvas.Text(new Rect(30,510,700,60),Instructions,17);
            GUI.enabled=Game.Phase=="playing"||Game.Phase=="paused";if(GameCanvas.Button(new Rect(795,515,130,55),Game.Phase=="paused"?"继续":"暂停"))Game.Pause();GUI.enabled=true;
            if(Game.Phase=="ready"||Game.Phase=="won"||Game.Phase=="lost"||Game.Phase=="paused"){
                GameCanvas.Fill(new Rect(175,135,610,345),new Color(.035f,.09f,.14f,.98f));GameCanvas.Text(new Rect(220,165,520,62),Game.Phase=="ready"?"准备出发":Game.Phase=="won"?"挑战完成！":Game.Phase=="paused"?"已暂停":"挑战结束",30);GameCanvas.Text(new Rect(220,240,520,115),Game is DialogueSimulation ending&&Game.Phase!="ready"&&Game.Phase!="paused"?ending.Text:Instructions,22);if(GameCanvas.Button(new Rect(325,395,310,55),Game.Phase=="ready"?"开始游戏":Game.Phase=="paused"?"继续游戏":"重新挑战")){if(Game.Phase=="paused")Game.Pause();else Game.Start();}}
            GameCanvas.End();
        }
    }
    [System.Serializable] public sealed class ArcadePublicState {public string runtime,genre,specVersionId,phase,board;public float elapsed,x,y;public int health,score,wave,currency,node;public bool hasKey;}
}

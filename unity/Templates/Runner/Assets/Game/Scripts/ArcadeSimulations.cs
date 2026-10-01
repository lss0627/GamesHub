using System.Collections.Generic;
using UnityEngine;

namespace GamerHub.Runner
{
    public abstract class PrototypeSession
    {
        public readonly RunnerGameConfigData Config;
        public string Phase { get; protected set; }="ready";
        public float Elapsed { get; protected set; }
        public int Score { get; protected set; }
        public int Health { get; protected set; }
        protected PrototypeSession(RunnerGameConfigData config) { Config=config; }
        protected void Prepare() { Start();Phase="ready"; }
        public void Start() { Elapsed=0;Score=0;Health=Mathf.Max(1,Config.maxHp);Phase="playing";Reset(); }
        public void Pause() { if(Phase=="playing")Phase="paused";else if(Phase=="paused")Phase="playing"; }
        public void Step(float delta,float horizontal,bool action) {
            if(Phase!="playing" || delta<=0 || float.IsNaN(delta) || float.IsInfinity(delta))return;
            var finish=Mathf.Min(Config.levelDurationSeconds,Elapsed+delta);var remaining=finish-Elapsed;
            while(remaining>0 && Phase=="playing") { var dt=Mathf.Min(.02f,remaining);remaining-=dt;Elapsed+=dt;Advance(dt,Mathf.Clamp(horizontal,-1,1),action);action=false; }
            if(Phase=="playing"){Elapsed=finish;if(Elapsed>=Config.levelDurationSeconds)Phase="lost";}
        }
        protected abstract void Reset();
        protected abstract void Advance(float delta,float horizontal,bool action);
    }
    public sealed class FlappySimulation : PrototypeSession
    {
        public sealed class Gate { public float X,Center; public bool Scored; }
        public readonly List<Gate> Gates=new List<Gate>();
        public Vector2 Player { get; private set; }
        public const int Goal=8;
        private float velocity,spawn; private System.Random random;
        public FlappySimulation(RunnerGameConfigData config):base(config){Prepare();}
        protected override void Reset(){Player=new Vector2(4,5);velocity=0;spawn=.8f;Gates.Clear();random=new System.Random(Config.seed);}
        protected override void Advance(float dt,float horizontal,bool action){
            if(action)velocity=6.5f;velocity-=15*dt;Player+=Vector2.up*velocity*dt;
            if(Player.y<.3f || Player.y>9.7f){Phase="lost";return;}
            spawn-=dt;if(spawn<=0){Gates.Add(new Gate{X=23,Center=3.5f+(float)random.NextDouble()*3});spawn=Config.spawnIntervalSeconds;}
            for(int i=Gates.Count-1;i>=0;i--){var gate=Gates[i];gate.X-=Config.playerSpeed*dt;
                if(Mathf.Abs(gate.X-Player.x)<.65f && Mathf.Abs(gate.Center-Player.y)>1.35f){Phase="lost";return;}
                if(!gate.Scored && gate.X<Player.x){gate.Scored=true;Score++;if(Score>=Goal){Phase="won";return;}}
                if(gate.X< -2)Gates.RemoveAt(i);
            }
        }
    }
    public sealed class BreakoutSimulation : PrototypeSession
    {
        public readonly List<Vector2> Bricks=new List<Vector2>();
        public Vector2 Ball,Velocity;
        public float Paddle { get; private set; }
        public BreakoutSimulation(RunnerGameConfigData config):base(config){Prepare();}
        protected override void Reset(){Paddle=11;Ball=new Vector2(11,1.3f);Velocity=Vector2.zero;Bricks.Clear();for(int row=0;row<3;row++)for(int col=0;col<8;col++)Bricks.Add(new Vector2(3+col*2.25f,7+row*.8f));}
        protected override void Advance(float dt,float horizontal,bool action){
            Paddle=Mathf.Clamp(Paddle+horizontal*Config.playerSpeed*2*dt,1.6f,20.4f);
            if(Velocity==Vector2.zero){Ball=new Vector2(Paddle,1.3f);if(action)Velocity=new Vector2(2,6).normalized*(Config.playerSpeed+2);return;}
            var previous=Ball;Ball+=Velocity*dt;
            if(Ball.x<.25f || Ball.x>21.75f){Ball.x=Mathf.Clamp(Ball.x,.25f,21.75f);Velocity.x=-Velocity.x;}
            if(Ball.y>9.7f){Ball.y=9.7f;Velocity.y=-Mathf.Abs(Velocity.y);}
            if(Velocity.y<0 && previous.y>=1 && Ball.y<=1 && Mathf.Abs(Ball.x-Paddle)<1.8f){Ball.y=1;Velocity=new Vector2((Ball.x-Paddle)*3,6).normalized*(Config.playerSpeed+2);}
            for(int i=Bricks.Count-1;i>=0;i--)if(Mathf.Abs(Bricks[i].x-Ball.x)<1.1f && Mathf.Abs(Bricks[i].y-Ball.y)<.48f){Bricks.RemoveAt(i);Score++;Velocity.y=-Velocity.y;if(Bricks.Count==0)Phase="won";break;}
            if(Ball.y<0){Health--;if(Health<=0)Phase="lost";else{Velocity=Vector2.zero;Ball=new Vector2(Paddle,1.3f);}}
        }
    }
    public sealed class PlatformerSimulation : PrototypeSession
    {
        public Vector2 Player;
        public float Checkpoint { get; private set; }
        public bool Grounded { get; private set; }
        public readonly List<Vector2> Coins=new List<Vector2>();
        private float velocity;
        public PlatformerSimulation(RunnerGameConfigData config):base(config){Prepare();}
        protected override void Reset(){Player=new Vector2(1,1);Checkpoint=1;Grounded=true;velocity=0;Coins.Clear();for(int i=0;i<12;i++)Coins.Add(new Vector2(3+i*3.2f,1.6f));}
        public static bool IsPit(float x)=>(x>8&&x<10)||(x>20&&x<23)||(x>32&&x<35);
        protected override void Advance(float dt,float horizontal,bool action){
            if(action && Grounded){velocity=Mathf.Max(6,Config.jumpVelocity);Grounded=false;}
            Player.x=Mathf.Clamp(Player.x+horizontal*Config.playerSpeed*dt,.5f,44);
            velocity-=18*dt;Player.y+=velocity*dt;
            if(!IsPit(Player.x) && Player.y<=1 && Player.y>=.2f && velocity<=0){Player.y=1;velocity=0;Grounded=true;}else Grounded=false;
            if(Player.y< -2){Health--;if(Health<=0){Phase="lost";return;}Player=new Vector2(Checkpoint,1);velocity=0;Grounded=true;}
            if(Player.x>=13 && Player.x<20 && Grounded)Checkpoint=13;
            if(Player.x>=26 && Player.x<32 && Grounded)Checkpoint=26;
            for(int i=Coins.Count-1;i>=0;i--)if(Vector2.Distance(Coins[i],Player)<.8f){Coins.RemoveAt(i);Score+=Config.scorePerCoin;}
            if(Player.x>=43)Phase="won";
        }
    }
    public sealed class TowerDefenseSimulation : PrototypeSession
    {
        public sealed class Invader { public Vector2 Position;public int Hp,Next; }
        public sealed class Tower { public int Cell,Level=1;public float Cooldown; }
        public readonly List<Invader> Enemies=new List<Invader>();
        public readonly List<Tower> Towers=new List<Tower>();
        public static readonly Vector2[] Route={new Vector2(0,5),new Vector2(6,5),new Vector2(6,2),new Vector2(13,2),new Vector2(13,7),new Vector2(21,7)};
        public static readonly Vector2[] Sites={new Vector2(3,4),new Vector2(7,3),new Vector2(10,3),new Vector2(12,5),new Vector2(16,6),new Vector2(19,6)};
        public int Currency { get; private set; }
        public int Wave { get; private set; }
        public int Kills { get; private set; }
        private int remaining;private float spawn;
        public TowerDefenseSimulation(RunnerGameConfigData config):base(config){Prepare();}
        protected override void Reset(){Enemies.Clear();Towers.Clear();Currency=100;Wave=1;Kills=0;remaining=4;spawn=1;}
        public bool Build(int cell){if(Phase!="playing" || cell<0||cell>=Sites.Length)return false;var tower=Towers.Find(t=>t.Cell==cell);var cost=tower==null?30:30*tower.Level;if(Currency<cost||tower!=null&&tower.Level>=3)return false;Currency-=cost;if(tower==null)Towers.Add(new Tower{Cell=cell});else tower.Level++;return true;}
        protected override void Advance(float dt,float horizontal,bool action){
            spawn-=dt;if(remaining>0&&spawn<=0){Enemies.Add(new Invader{Position=Route[0],Hp=Config.enemyHp+Wave-1,Next=1});remaining--;spawn=Mathf.Max(.5f,Config.spawnIntervalSeconds*.4f);}
            for(int i=Enemies.Count-1;i>=0;i--){var enemy=Enemies[i];enemy.Position=Vector2.MoveTowards(enemy.Position,Route[Mathf.Min(enemy.Next,Route.Length-1)],Mathf.Max(.5f,Config.enemySpeed)*dt*1.5f);if(Vector2.Distance(enemy.Position,Route[Mathf.Min(enemy.Next,Route.Length-1)])<.05f)enemy.Next++;if(enemy.Next>=Route.Length){Enemies.RemoveAt(i);Health--;if(Health<=0){Phase="lost";return;}}}
            foreach(var tower in Towers){tower.Cooldown-=dt;if(tower.Cooldown>0)continue;var target=Enemies.Find(e=>Vector2.Distance(e.Position,Sites[tower.Cell])<3.6f);if(target==null)continue;tower.Cooldown=Config.attackInterval;target.Hp-=Config.damage*tower.Level;if(target.Hp<=0){Enemies.Remove(target);Kills++;Score++;Currency+=15;}}
            if(remaining==0&&Enemies.Count==0){if(Wave>=5){Phase="won";return;}Wave++;remaining=3+Wave;spawn=1.5f;Currency+=20;}
        }
    }
    public sealed class PuzzleSimulation : PrototypeSession
    {
        public static readonly string[] Map={"########","# .  . #","# $  $ #","#   $ .#","#  @   #","########"};
        public readonly HashSet<Vector2Int> Boxes=new HashSet<Vector2Int>();
        public readonly HashSet<Vector2Int> Goals=new HashSet<Vector2Int>();
        public Vector2Int Player { get; private set; }
        private readonly Stack<(Vector2Int,HashSet<Vector2Int>)> history=new Stack<(Vector2Int,HashSet<Vector2Int>)>();
        public PuzzleSimulation(RunnerGameConfigData config):base(config){Prepare();}
        protected override void Reset(){Boxes.Clear();Goals.Clear();history.Clear();for(int y=0;y<Map.Length;y++)for(int x=0;x<Map[y].Length;x++){var p=new Vector2Int(x,y);if(Map[y][x]=='$')Boxes.Add(p);if(Map[y][x]=='.')Goals.Add(p);if(Map[y][x]=='@')Player=p;}}
        private bool Wall(Vector2Int p)=>p.y<0||p.y>=Map.Length||p.x<0||p.x>=Map[0].Length||Map[p.y][p.x]=='#';
        public bool Move(int x,int y){if(Phase!="playing"||Mathf.Abs(x)+Mathf.Abs(y)!=1)return false;var direction=new Vector2Int(x,-y);var next=Player+direction;if(Wall(next))return false;var pushed=next+direction;if(Boxes.Contains(next)&&(Wall(pushed)||Boxes.Contains(pushed)))return false;history.Push((Player,new HashSet<Vector2Int>(Boxes)));if(Boxes.Remove(next))Boxes.Add(pushed);Player=next;Score++;if(Boxes.SetEquals(Goals))Phase="won";return true;}
        public bool Undo(){if((Phase!="playing"&&Phase!="won")||history.Count==0)return false;var old=history.Pop();Player=old.Item1;Boxes.Clear();Boxes.UnionWith(old.Item2);Score--;Phase="playing";return true;}
        protected override void Advance(float dt,float horizontal,bool action){}
        public string Board(){var text="";for(int y=0;y<Map.Length;y++)for(int x=0;x<Map[y].Length;x++){var p=new Vector2Int(x,y);text+=Player==p?'@':Boxes.Contains(p)?(Goals.Contains(p)?'*':'$'):Goals.Contains(p)?'.':Wall(p)?'#':' ';}return text;}
    }
    public sealed class DialogueSimulation : PrototypeSession
    {
        public int Node { get; private set; }
        public bool HasKey { get; private set; }
        public string Text=>Node==0?"暮色降临，你来到森林营地。守护者说，星灯被锁在旧塔里。你打算先去哪里？":Node==1?"你帮助小狐狸找回了行囊。它递来一把星形钥匙，指向河边的旧塔。":Node==2?"河水上涨，旧塔就在对岸。石桥安全，但桥头的大门需要钥匙。远处的风暴小径似乎能绕过去。":Node==3?"钥匙转动，星灯亮起。你把灯带回营地，为迷路的旅人照亮了回家的路。":"你走进了风暴。道路被水淹没，只能结束这次探险。";
        public string[] Choices=>Node==0?new[]{"去森林帮助小狐狸","到河边寻找旧塔"}:Node==1?new[]{"收下钥匙，返回营地","带着钥匙前往河边"}:Node==2?new[]{HasKey?"用钥匙打开大门":"没有钥匙，返回营地","冒险穿过风暴小径"}:new string[0];
        public DialogueSimulation(RunnerGameConfigData config):base(config){Prepare();}
        protected override void Reset(){Node=0;HasKey=false;}
        public void Choose(int index){if(Phase!="playing"||index<0||index>=Choices.Length)return;Score++;if(Node==0)Node=index==0?1:2;else if(Node==1){HasKey=true;Node=index==0?0:2;}else if(Node==2){if(index==1){Node=4;Phase="lost";}else if(HasKey){Node=3;Phase="won";}else Node=0;}}
        protected override void Advance(float dt,float horizontal,bool action){}
    }
}

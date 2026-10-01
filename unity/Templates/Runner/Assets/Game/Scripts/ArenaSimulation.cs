using System;
using System.Collections.Generic;
using UnityEngine;

namespace GamerHub.Runner
{
    public sealed class ArenaSimulation
    {
        public sealed class Enemy { public Vector2 Position; public int Hp; public int Kind; }
        public sealed class Projectile { public Vector2 Position, Direction; public float Remaining; public int Damage; }
        public readonly RunnerGameConfigData Config;
        public readonly List<Enemy> Enemies = new List<Enemy>();
        public readonly List<Vector2> Pickups = new List<Vector2>();
        public readonly List<Projectile> Projectiles = new List<Projectile>();
        public string Phase { get; private set; } = "ready";
        public Vector2 Player { get; private set; }
        public Vector2 Aim { get; private set; } = Vector2.right;
        public Vector2 LastTarget { get; private set; }
        public int Health { get; private set; }
        public int Kills { get; private set; }
        public int Attacks { get; private set; }
        public int Hits { get; private set; }
        public int Xp { get; private set; }
        public int Level { get; private set; } = 1;
        public int Damage { get; private set; }
        public int ProjectileCount { get; private set; } = 1;
        public float Cooldown { get; private set; }
        public float Elapsed { get; private set; }
        public int Tick { get; private set; }
        public float Flash { get; private set; }
        private float spawnTime, attackTime, hurtTime;
        private System.Random random;
        public ArenaSimulation(RunnerGameConfigData config) { Config=config; Reset(); Phase="ready"; }
        private void Reset() {
            Player=Vector2.zero; Aim=Vector2.right; Health=Config.maxHp; Kills=Attacks=Hits=Xp=Tick=0; Level=ProjectileCount=1;
            Damage=Config.damage; Cooldown=Config.attackInterval; Elapsed=spawnTime=attackTime=hurtTime=Flash=0;
            Enemies.Clear(); Pickups.Clear(); Projectiles.Clear(); random=new System.Random(Config.seed);
        }
        public void Start() { Reset(); Phase="playing"; }
        public void Pause() { if(Phase=="playing") Phase="paused"; else if(Phase=="paused") Phase="playing"; }
        public Enemy SpawnEnemy(Vector2 position, int kind=0) {
            var enemy=new Enemy { Position=position, Hp=Config.enemyHp*(kind==2?2:1), Kind=kind }; Enemies.Add(enemy); return enemy;
        }
        public void Step(float delta, Vector2 movement, bool fire) => Step(delta,movement,fire,Aim);
        public void Step(float delta, Vector2 movement, bool fire, Vector2 aim) {
            if(Phase!="playing" || delta<=0 || float.IsNaN(delta) || float.IsInfinity(delta)) return;
            if(aim.sqrMagnitude>.01f) Aim=aim.normalized;
            Tick++;
            var finish=Mathf.Min(Config.levelDurationSeconds,Elapsed+delta);
            var remaining=Mathf.Max(0,finish-Elapsed);
            while(remaining>0 && Phase=="playing") {
                var dt=Mathf.Min(.02f,remaining); remaining-=dt; Advance(dt,movement,fire);
            }
            if(Phase=="playing") { Elapsed=finish;if(Elapsed>=Config.levelDurationSeconds)Phase="won"; }
        }
        private void Hit(Enemy enemy,int damage) {
            Hits++; enemy.Hp-=damage; LastTarget=enemy.Position; Flash=.13f;
            if(enemy.Hp<=0) { Kills++; Pickups.Add(enemy.Position); Enemies.Remove(enemy); }
        }
        private void Advance(float delta,Vector2 movement,bool fire) {
            Elapsed+=delta;
            Player+=Vector2.ClampMagnitude(movement,1)*Config.playerSpeed*delta;
            Player=new Vector2(Mathf.Clamp(Player.x,-10,10),Mathf.Clamp(Player.y,-4.5f,4.5f));
            Flash=Mathf.Max(0,Flash-delta); hurtTime-=delta; attackTime-=delta; spawnTime-=delta;
            if(spawnTime<=0 && Enemies.Count<60) {
                var side=random.Next(4); var x=(float)(random.NextDouble()*18-9); var y=(float)(random.NextDouble()*8-4);
                var kind=Elapsed<10?0:random.Next(3);
                SpawnEnemy(side<2 ? new Vector2(side==0?-10:10,y) : new Vector2(x,side==2?-4.5f:4.5f),kind);
                spawnTime=Config.spawnIntervalSeconds;
            }
            foreach(var enemy in Enemies) {
                var speed=Config.enemySpeed*(enemy.Kind==1?1.5f:enemy.Kind==2?.65f:1);
                enemy.Position=Vector2.MoveTowards(enemy.Position,Player,speed*delta);
                if(Vector2.Distance(enemy.Position,Player)<.65f && hurtTime<=0) {
                    Health--; hurtTime=.9f;
                    if(Health<=0) { Phase="lost"; return; }
                }
            }
            if(attackTime<=0) {
                if(Config.genre=="top_down_shooter" && fire) {
                    attackTime=Cooldown; Attacks++;
                    for(int i=0;i<ProjectileCount;i++) {
                        var angle=(i-(ProjectileCount-1)/2f)*12*Mathf.Deg2Rad;
                        var direction=new Vector2(Aim.x*Mathf.Cos(angle)-Aim.y*Mathf.Sin(angle),Aim.x*Mathf.Sin(angle)+Aim.y*Mathf.Cos(angle));
                        Projectiles.Add(new Projectile{Position=Player,Direction=direction,Remaining=Config.attackRange,Damage=Damage});
                    }
                } else if(Config.genre!="top_down_shooter") {
                    var targets=new List<Enemy>(Enemies); targets.Sort((a,b)=>Vector2.Distance(a.Position,Player).CompareTo(Vector2.Distance(b.Position,Player)));
                    var hit=0;
                    foreach(var target in targets) {
                        if(hit>=ProjectileCount || Vector2.Distance(target.Position,Player)>Config.attackRange)break;
                        Hit(target,Damage); hit++;
                    }
                    if(hit>0) { attackTime=Cooldown;Attacks++; }
                }
            }
            for(int i=Projectiles.Count-1;i>=0;i--) {
                var projectile=Projectiles[i];var distance=Mathf.Min(14*delta,projectile.Remaining);
                projectile.Position+=projectile.Direction*distance;projectile.Remaining-=distance;
                Enemy target=null;
                foreach(var enemy in Enemies) if(Vector2.Distance(projectile.Position,enemy.Position)<.5f){target=enemy;break;}
                if(target!=null)Hit(target,projectile.Damage);
                if(target!=null || projectile.Remaining<=0)Projectiles.RemoveAt(i);
            }
            for(var i=Pickups.Count-1;i>=0;i--) {
                if(Vector2.Distance(Player,Pickups[i])>1.3f) continue;
                Pickups.RemoveAt(i); Xp++;
                if(Xp>=Config.xpPerLevel) { Phase="upgrade"; break; }
            }
        }
        public void ChooseUpgrade(int choice) {
            if(Phase!="upgrade" || choice<0 || choice>=Mathf.Clamp(Config.upgradeChoicesCount,3,4)) return;
            if(choice==0) Damage++;
            if(choice==1) Cooldown=Mathf.Max(.1f,Cooldown*.8f);
            if(choice==2) Health=Mathf.Min(Config.maxHp,Health+2);
            if(choice==3) ProjectileCount=Mathf.Min(5,ProjectileCount+1);
            Xp-=Config.xpPerLevel; Level++; Phase="playing";
        }
    }
}

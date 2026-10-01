using System;
using System.Runtime.InteropServices;
using UnityEngine;

namespace GamerHub.Runner
{
    public static class GameCanvas
    {
        private static Matrix4x4 before;
        private static Font font;
        public static void Begin() { before=GUI.matrix; GUI.matrix=Matrix4x4.Scale(new Vector3(Screen.width/960f,Screen.height/600f,1)); if(font==null)font=Resources.Load<Font>("Art/GameFont"); if(font!=null)GUI.skin.font=font; }
        public static string Title(string requested,string fallback) => string.IsNullOrWhiteSpace(requested)?fallback:requested;
        public static void End() { GUI.matrix=before; }
        public static void Fill(Rect rect, Color color) { var beforeColor=GUI.color; GUI.color=color; GUI.DrawTexture(rect,Texture2D.whiteTexture); GUI.color=beforeColor; }
        public static void Text(Rect rect,string text,int size=20, Color? color=null) {
            var style=new GUIStyle(GUI.skin.label){fontSize=size,alignment=TextAnchor.MiddleLeft,wordWrap=true};
            style.normal.textColor=color??new Color(.88f,.95f,.89f);
            while(style.fontSize>11 && style.CalcHeight(new GUIContent(text),rect.width)>rect.height)style.fontSize--;
            GUI.Label(rect,new GUIContent(text,text),style);
        }
        public static bool Button(Rect rect,string text) {
            Fill(rect,GUI.enabled?new Color(.21f,.43f,.37f):new Color(.16f,.23f,.24f));
            var style=new GUIStyle(GUI.skin.label){fontSize=19,fontStyle=FontStyle.Bold,alignment=TextAnchor.MiddleCenter,wordWrap=true};style.normal.textColor=GUI.enabled?Color.white:Color.gray;return GUI.Button(rect,text,style);
        }
        public static void Sprite(Texture2D texture,Vector2 position,float size,Color? tint=null) {
            if(texture==null) { Fill(new Rect(position.x-size/2,position.y-size/2,size,size),tint??Color.cyan); return; }
            var previous=GUI.color;GUI.color=tint??Color.white;GUI.DrawTexture(new Rect(position.x-size/2,position.y-size/2,size,size),texture,ScaleMode.ScaleToFit);GUI.color=previous;
        }
        public static Vector2 ScreenPoint(Vector2 point) => new Vector2(480+point.x*39,310-point.y*42);
        public static Vector2 WorldPoint(Vector2 point) => new Vector2((point.x-480)/39,(310-point.y)/42);
    }
    public static class GameStateReporter
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] private static extern void GamerHubState(string json);
#endif
        public static void Report(object state) {
            var json=JsonUtility.ToJson(state);
            CreativeRuntime.Observe(json);
#if UNITY_WEBGL && !UNITY_EDITOR
            GamerHubState(json);
#endif
        }
    }
    [Serializable] public sealed class PublicGameState
    {
        public string runtime,genre,specVersionId,phase;
        public float x,y,elapsed,damage,cooldown,xpX,xpY,total,wallet,perClick,autoIncome;
        public int health,kills,attacks,hits,xp,level,tick,pickups,enemies;
    }
}

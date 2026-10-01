using UnityEngine;
using UnityEngine.SceneManagement;

namespace GamerHub.Runner
{
    public sealed class RunnerGameManager : MonoBehaviour
    {
        public static RunnerGameManager Instance { get; private set; }
        public int Score { get; private set; }
        public int Coins { get; private set; }
        public bool IsStarted { get; private set; }
        public bool IsGameOver { get; private set; }
        public bool Won { get; private set; }
        public bool IsPaused { get; private set; }
        public float TouchHorizontal { get; private set; }
        public float RemainingSeconds => Mathf.Max(0f, RunnerGameConfig.Current.levelDurationSeconds - elapsed);
        private float elapsed;
        private float reportAt;
        private Texture2D panelTexture;
        private Texture2D buttonTexture;
        private GUIStyle titleStyle, bodyStyle, buttonStyle, hudStyle, panelStyle;

        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
        }
        public void StartGame() { if (!IsGameOver) IsStarted = true; }
        public void Pause() { if(!IsStarted || IsGameOver)return;IsPaused=!IsPaused;Time.timeScale=IsPaused?0:1; }
        private void Update()
        {
            if(Input.GetKeyDown(KeyCode.P)||Input.GetKeyDown(KeyCode.Escape))Pause();
            if(Time.realtimeSinceStartup>=reportAt){reportAt=Time.realtimeSinceStartup+.1f;var player=FindFirstObjectByType<PlayerController>();var position=player==null?Vector3.zero:player.transform.position;GameStateReporter.Report(new PublicGameState{runtime="runner-v1",genre="runner",specVersionId=RunnerGameConfig.Current.specVersionId,phase=IsPaused?"paused":!IsStarted?"ready":IsGameOver?(Won?"won":"lost"):"playing",elapsed=elapsed,x=position.x,y=position.y,total=Score,pickups=Coins});}
            if (!IsStarted || IsGameOver || IsPaused) return;
            elapsed += Time.deltaTime;
            if (RemainingSeconds <= 0f) { Won = true; IsGameOver = true; }
        }
        public void CollectCoin(int value)
        {
            if (!IsStarted || IsGameOver || IsPaused) return;
            Coins += 1;
            Score += Mathf.Max(0, value);
        }
        public void HitObstacle() { if (IsStarted && !IsPaused) IsGameOver = true; }
        public void Restart() { Time.timeScale=1;SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex); }
        private static Texture2D Solid(Color color)
        {
            var texture = new Texture2D(1, 1); texture.SetPixel(0, 0, color); texture.Apply(); return texture;
        }
        private void EnsureStyles()
        {
            if (titleStyle != null) return;
            var font=Resources.Load<Font>("Art/GameFont");if(font!=null)GUI.skin.font=font;
            panelTexture = Solid(new Color(1f, 0.99f, 0.94f, 0.97f));
            buttonTexture = Solid(new Color(0.27f, 0.41f, 0.31f));
            var ink = new Color(0.18f, 0.25f, 0.20f);
            titleStyle = new GUIStyle(GUI.skin.label) { fontSize = 25, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter,wordWrap=true };
            titleStyle.normal.textColor = ink;
            bodyStyle = new GUIStyle(GUI.skin.label) { fontSize = 18, alignment = TextAnchor.MiddleCenter, wordWrap = true };
            bodyStyle.normal.textColor = new Color(0.37f, 0.45f, 0.35f);
            buttonStyle = new GUIStyle(GUI.skin.button) { fontSize = 20, fontStyle = FontStyle.Bold };
            buttonStyle.normal.background = buttonTexture; buttonStyle.hover.background = buttonTexture; buttonStyle.active.background = buttonTexture;
            buttonStyle.normal.textColor = Color.white; buttonStyle.hover.textColor = Color.white;
            panelStyle = new GUIStyle(GUI.skin.box); panelStyle.normal.background = panelTexture;
            hudStyle = new GUIStyle(bodyStyle) { fontSize = 20, fontStyle = FontStyle.Bold };
        }
        private void OnGUI()
        {
            EnsureStyles();
            var previous = GUI.matrix;
            GUI.matrix = Matrix4x4.TRS(Vector3.zero, Quaternion.identity, new Vector3(Screen.width / 960f, Screen.height / 600f, 1));
            GUI.Box(new Rect(24, 22, 300, 50), GUIContent.none, panelStyle);
            GUI.Label(new Rect(24, 22, 300, 50), $"金币 {Coins}   |   得分 {Score}", hudStyle);
            GUI.Box(new Rect(750, 22, 186, 50), GUIContent.none, panelStyle);
            GUI.Label(new Rect(750, 22, 186, 50), $"剩余 {Mathf.CeilToInt(RemainingSeconds)} 秒", hudStyle);
            if(IsStarted && !IsGameOver && GUI.Button(new Rect(620,22,110,50),IsPaused?"继续":"暂停",buttonStyle))Pause();
            TouchHorizontal=0;
            if (!IsStarted || IsGameOver || IsPaused)
            {
                GUI.Box(new Rect(210, 130, 540, 310), GUIContent.none, panelStyle);
                var heading=IsPaused?"游戏已暂停":!IsStarted ? RunnerGameConfig.Current.gameName : Won ? "顺利通关！" : "再来一次冒险？";titleStyle.fontSize=25;while(titleStyle.fontSize>11&&titleStyle.CalcHeight(new GUIContent(heading),510)>52)titleStyle.fontSize--;GUI.Label(new Rect(225, 150, 510, 52),heading,titleStyle);
                var instruction = !IsStarted
                    ? $"收集金币，跳过木桩，坚持 {RunnerGameConfig.Current.levelDurationSeconds} 秒。\n\n方向键 / A D 移动，空格跳跃。\n触屏可使用下方方向和跳跃按钮。"
                    : IsPaused?"计时和场景已暂停，准备好了再继续。":$"收集 {Coins} 枚金币 · 得分 {Score}\n\n" + (Won ? "试试挑战更高的分数。" : "看准木桩，稍微提前起跳。");
                GUI.Label(new Rect(245, 205, 470, 135), instruction, bodyStyle);
                if (GUI.Button(new Rect(350, 360, 260, 52), IsPaused?"继续游戏":!IsStarted ? "开始冒险" : "重新挑战", buttonStyle))
                { if(IsPaused)Pause();else if (!IsStarted) StartGame(); else Restart(); }
            }
            else
            {
                if(GUI.RepeatButton(new Rect(24,510,90,66),"左",buttonStyle))TouchHorizontal=-1;
                if(GUI.RepeatButton(new Rect(128,510,90,66),"右",buttonStyle))TouchHorizontal=1;
                GUI.Label(new Rect(244, 530, 430, 48), "方向键移动 · 空格跳跃 · P 暂停", bodyStyle);
                if (GUI.Button(new Rect(794, 510, 140, 66), "跳跃", buttonStyle))
                { var player = FindFirstObjectByType<PlayerController>(); if (player != null) player.TryJump(); }
            }
            GUI.matrix = previous;
        }
        private void OnDestroy()
        {
            if (Instance == this) { Instance = null;Time.timeScale=1; }
            if (panelTexture != null) Destroy(panelTexture);
            if (buttonTexture != null) Destroy(buttonTexture);
        }
    }
}

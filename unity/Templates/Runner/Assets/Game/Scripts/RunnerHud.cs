using UnityEngine;
using UnityEngine.UI;

namespace GamerHub.Runner
{
    public sealed class RunnerHud : MonoBehaviour
    {
        [SerializeField] private Text scoreLabel;
        [SerializeField] private Text coinsLabel;
        [SerializeField] private GameObject gameOverPanel;

        private void Update()
        {
            var manager = RunnerGameManager.Instance;
            if (manager == null) return;
            if (scoreLabel != null) scoreLabel.text = $"Score: {manager.Score}";
            if (coinsLabel != null) coinsLabel.text = $"Coins: {manager.Coins}";
            if (gameOverPanel != null) gameOverPanel.SetActive(manager.IsGameOver);
        }

        public void Restart() => RunnerGameManager.Instance?.Restart();
    }
}

using UnityEngine;

namespace GamerHub.Runner
{
    public sealed class Coin : MonoBehaviour
    {
        [SerializeField] private int value = 10;

        public int Value => value;

        private void Awake() => value = RunnerGameConfig.Current.scorePerCoin;

        private void OnTriggerEnter2D(Collider2D other)
        {
            if (!other.CompareTag("Player")) return;
            if(RunnerGameManager.Instance==null || !RunnerGameManager.Instance.IsStarted || RunnerGameManager.Instance.IsPaused || RunnerGameManager.Instance.IsGameOver)return;
            RunnerGameManager.Instance?.CollectCoin(value);
            Destroy(gameObject);
        }
    }
}

using UnityEngine;

namespace GamerHub.Runner
{
    public sealed class WorldMover : MonoBehaviour
    {
        private float speed;

        public void Configure(float value) => speed = Mathf.Max(0.1f, value);

        private void Update()
        {
            if (RunnerGameManager.Instance == null || !RunnerGameManager.Instance.IsStarted || RunnerGameManager.Instance.IsGameOver) return;
            transform.position += Vector3.left * (speed * Time.deltaTime);
            if (transform.position.x < -14f) Destroy(gameObject);
        }
    }
}

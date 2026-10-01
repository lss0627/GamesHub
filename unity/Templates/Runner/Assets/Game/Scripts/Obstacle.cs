using UnityEngine;

namespace GamerHub.Runner
{
    public sealed class Obstacle : MonoBehaviour
    {
        private void OnCollisionEnter2D(Collision2D collision)
        {
            if (collision.collider.CompareTag("Player")) RunnerGameManager.Instance?.HitObstacle();
        }
    }
}

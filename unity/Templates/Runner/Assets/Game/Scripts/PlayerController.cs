using UnityEngine;

namespace GamerHub.Runner
{
    [RequireComponent(typeof(Rigidbody2D))]
    public sealed class PlayerController : MonoBehaviour
    {
        [SerializeField] private float moveSpeed = 6f;
        [SerializeField] private float jumpVelocity = 7f;
        [SerializeField] private Transform groundCheck;
        [SerializeField] private LayerMask groundMask;
        private Rigidbody2D body;
        private bool grounded;

        public float MoveSpeed => moveSpeed;
        public float JumpVelocity => jumpVelocity;
        public bool IsGrounded => grounded;

        private void Awake()
        {
            body = GetComponent<Rigidbody2D>();
            var config = RunnerGameConfig.Current;
            moveSpeed = config.playerSpeed;
            jumpVelocity = config.jumpVelocity;
        }

        private void Update()
        {
            if (RunnerGameManager.Instance != null && RunnerGameManager.Instance.IsGameOver)
            {
                body.linearVelocity = Vector2.zero;
                body.gravityScale = 0;
                return;
            }
            if(RunnerGameManager.Instance!=null && RunnerGameManager.Instance.IsPaused)return;
            if (RunnerGameManager.Instance == null || !RunnerGameManager.Instance.IsStarted || RunnerGameManager.Instance.IsGameOver)
            {
                body.linearVelocity = new Vector2(0, body.linearVelocity.y);
                return;
            }
            var horizontal = Mathf.Clamp(Input.GetAxisRaw("Horizontal")+RunnerGameManager.Instance.TouchHorizontal,-1,1);
            body.linearVelocity = new Vector2(horizontal * moveSpeed, body.linearVelocity.y);
            grounded = groundCheck != null
                ? Physics2D.OverlapCircle(groundCheck.position, 0.12f, groundMask)
                : HasGroundBelow();
            if (Input.GetButtonDown("Jump") || Input.GetKeyDown(KeyCode.Space)) TryJump();
            var position = transform.position;
            position.x = Mathf.Clamp(position.x, -7.5f, 7.5f);
            transform.position = position;
            if (position.y < -5f) RunnerGameManager.Instance.HitObstacle();
        }

        public bool TryJump()
        {
            if (RunnerGameManager.Instance == null || !RunnerGameManager.Instance.IsStarted || RunnerGameManager.Instance.IsGameOver || RunnerGameManager.Instance.IsPaused || !HasGroundBelow()) return false;
            body.linearVelocity = new Vector2(body.linearVelocity.x, jumpVelocity);
            return true;
        }

        private bool HasGroundBelow()
        {
            foreach (var hit in Physics2D.RaycastAll(transform.position, Vector2.down, 0.85f))
                if (hit.collider != null && hit.collider.gameObject != gameObject) return true;
            return false;
        }
    }
}

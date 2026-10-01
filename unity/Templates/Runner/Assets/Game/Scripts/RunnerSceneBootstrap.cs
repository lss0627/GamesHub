using System.Collections;
using UnityEngine;

namespace GamerHub.Runner
{
    public sealed class RunnerSceneBootstrap : MonoBehaviour
    {
        private void Start()
        {
            Random.InitState(RunnerGameConfig.Current.seed);
            EnsureCamera();
            var background = new GameObject("ForestBackground");
            background.transform.position = new Vector3(0f, 2f, 0f);
            AddArt(background, "forest", new Vector2(17.6f, 11f), -10);
            var ground = CreateGround();
            CreatePlayer(ground);
            CreateCoin(new Vector3(-2f, 0.35f, 0f), true);
            CreateObstacle(new Vector3(3f, -0.03f, 0f), true);
            StartCoroutine(SpawnLoop());
        }

        private static void EnsureCamera()
        {
            if (Camera.main != null) return;
            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            cameraObject.transform.position = new Vector3(0f, 2f, -10f);
            var camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 5.5f;
            camera.backgroundColor = new Color(0.16f, 0.3f, 0.52f);
        }

        private static GameObject CreateGround()
        {
            var ground = new GameObject("Ground");
            ground.transform.position = new Vector3(0f, -1f, 0f);
            var collider = ground.AddComponent<BoxCollider2D>();
            collider.size = new Vector2(40f, 1f);
            return ground;
        }

        private static void CreatePlayer(GameObject ground)
        {
            var player = new GameObject("Player") { tag = "Player" };
            player.transform.position = new Vector3(-6f, 0f, 0f);
            var body = player.AddComponent<Rigidbody2D>();
            body.freezeRotation = true;
            var collider = player.AddComponent<BoxCollider2D>();
            collider.size = new Vector2(0.8f, 1.4f);
            AddArt(player, "cat", new Vector2(1.65f, 1.65f), 3);
            player.AddComponent<PlayerController>();
            Physics2D.IgnoreCollision(collider, ground.GetComponent<Collider2D>(), false);
        }

        private static void CreateCoin(Vector3 position, bool moving)
        {
            var coin = new GameObject("Coin");
            coin.transform.position = position;
            var collider = coin.AddComponent<CircleCollider2D>();
            collider.isTrigger = true;
            collider.radius = 0.28f;
            AddArt(coin, "coin", new Vector2(0.65f, 0.65f), 2);
            coin.AddComponent<Coin>();
            if (moving) coin.AddComponent<WorldMover>().Configure(RunnerGameConfig.Current.playerSpeed * 0.55f);
        }

        private static void CreateObstacle(Vector3 position, bool moving)
        {
            var obstacle = new GameObject("Obstacle");
            obstacle.transform.position = position;
            var collider = obstacle.AddComponent<BoxCollider2D>();
            collider.size = new Vector2(0.8f, 0.8f);
            AddArt(obstacle, "stump", new Vector2(1.2f, 1.2f), 2);
            obstacle.AddComponent<Obstacle>();
            if (moving) obstacle.AddComponent<WorldMover>().Configure(RunnerGameConfig.Current.playerSpeed * 0.55f);
        }

        private IEnumerator SpawnLoop()
        {
            var index = 0;
            yield return new WaitUntil(() => RunnerGameManager.Instance != null && RunnerGameManager.Instance.IsStarted);
            while (true)
            {
                yield return new WaitForSeconds(RunnerGameConfig.Current.spawnIntervalSeconds);
                if (RunnerGameManager.Instance != null && RunnerGameManager.Instance.IsGameOver) yield break;
                if (index++ % 2 == 0)
                    CreateCoin(new Vector3(10f, Random.Range(0.2f, 0.9f), 0f), true);
                else
                    CreateObstacle(new Vector3(10f, -0.03f, 0f), true);
            }
        }

        private static void AddArt(GameObject target, string name, Vector2 size, int order)
        {
            var texture = Resources.Load<Texture2D>("Art/" + name);
            if (texture == null) throw new System.InvalidOperationException("RUNNER_ART_MISSING: " + name);
            var renderer = target.AddComponent<SpriteRenderer>();
            renderer.sprite = Sprite.Create(
                texture,
                new Rect(0, 0, texture.width, texture.height),
                new Vector2(0.5f, 0.5f),
                100f,
                0,
                SpriteMeshType.FullRect
            );
            renderer.sortingOrder = order;
            // Size the sprite itself: scaling the GameObject would also enlarge its collider.
            renderer.drawMode = SpriteDrawMode.Sliced;
            renderer.size = size;
        }
    }
}

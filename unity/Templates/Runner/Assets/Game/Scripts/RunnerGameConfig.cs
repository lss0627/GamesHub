using System;
using UnityEngine;

namespace GamerHub.Runner
{
    [Serializable]
    public sealed class RunnerGameConfigData
    {
        public string runtime = "runner-v1";
        public string genre = "runner";
        public int seed = 42;
        public int maxHp = 5;
        public int enemyHp = 2;
        public float enemySpeed = 1f;
        public int damage = 1;
        public float attackInterval = .7f;
        public float attackRange = 5f;
        public int xpPerLevel = 3;
        public int upgradeChoicesCount = 4;
        public int upgradeCost = 30;
        public int goal = 300;
        public int autoIncome = 0;
        public string gameName = "Cat Coin Runner";
        public string description = "A generated Unity runner";
        public float playerSpeed = 6f;
        public float jumpVelocity = 3.5f;
        public int scorePerCoin = 10;
        public float spawnIntervalSeconds = 2f;
        public int levelDurationSeconds = 60;
        public string playerAssetId = "cat_player";
        public string specVersionId = "template-default";
    }

    public static class RunnerGameConfig
    {
        private static RunnerGameConfigData current;

        public static RunnerGameConfigData Current
        {
            get
            {
                if (current != null) return current;
                var asset = Resources.Load<TextAsset>("GamerHubGameConfig");
                current = asset == null
                    ? new RunnerGameConfigData()
                    : JsonUtility.FromJson<RunnerGameConfigData>(asset.text) ?? new RunnerGameConfigData();
                current.playerSpeed = Mathf.Clamp(current.playerSpeed, 0.1f, 1000f);
                current.jumpVelocity = Mathf.Clamp(current.jumpVelocity, 0f, 100f);
                current.scorePerCoin = Mathf.Max(0, current.scorePerCoin);
                current.spawnIntervalSeconds = Mathf.Clamp(current.spawnIntervalSeconds, 0.1f, 3600f);
                current.levelDurationSeconds = Mathf.Clamp(current.levelDurationSeconds, 10, 3600);
                return current;
            }
        }

        public static void Reload() => current = null;
    }
}

import { makeSkill } from '../registry';
export function createCoinSystemSkill() {
  return makeSkill({
    id: 'create_coin_system',
    requiredEngineCapabilities: ['prefab.create', 'script.create'],
    artifacts: [
      'Assets/Game/Scripts/Coin.cs',
      'Assets/Game/Prefabs/Coin.prefab',
    ],
    validationReference: 'RunnerPlayModeTests.CoinPickupAddsScore',
  });
}

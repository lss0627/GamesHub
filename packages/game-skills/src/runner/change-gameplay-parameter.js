import { makeSkill } from '../registry';
export function changeGameplayParameterSkill() {
  return makeSkill({
    id: 'change_gameplay_parameter',
    requiredEngineCapabilities: ['component.set_property'],
    artifacts: ['Assets/Game/Scripts/PlayerController.cs'],
    validationReference: 'RunnerEditModeTests.GameplayParameterUpdate',
  });
}

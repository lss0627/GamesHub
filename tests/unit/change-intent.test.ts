import { classifyChangeIntent } from '@gamerhub/game-spec';
import { describe, expect, it } from 'vitest';

describe('change intent', () => {
  it('distinguishes create, local modify and out-of-scope requests', () => {
    expect(classifyChangeIntent('做一个猫咪跑酷游戏')).toBe('create');
    expect(classifyChangeIntent('把跳跃高度改成 5', true)).toBe('modify');
    expect(classifyChangeIntent('猫跳得太高了', true)).toBe('modify');
    expect(classifyChangeIntent('加入多人联机模式', true)).toBe('out_of_scope');
  });
});

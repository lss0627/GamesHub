import { describe, expect, it } from 'vitest';
import { describeRunFailure } from '../../apps/studio-web/src/features/runs/run-failure';

describe('run failure presentation', () => {
  it('turns DeepSeek HTTP 402 into actionable creator guidance', () => {
    expect(
      describeRunFailure({
        code: 'PROVIDER_ERROR',
        message: 'PROVIDER_ERROR: Model provider returned HTTP 402',
      }),
    ).toEqual({
      intent: 'error',
      title: 'AI 模型额度不足',
      message:
        'DeepSeek 返回 HTTP 402（余额或额度不足）。请为当前 API Key 对应账户充值后重新尝试。',
    });
  });

  it('keeps scope failures distinct from infrastructure failures', () => {
    expect(describeRunFailure({ code: 'OUT_OF_SCOPE' }).intent).toBe(
      'out_of_scope',
    );
    expect(describeRunFailure({ code: 'RUN_STATUS_FAILED_503' }).intent).toBe(
      'error',
    );
  });

  it('provides recovery guidance for offline local services', () => {
    expect(
      describeRunFailure({ code: 'RUN_CREATE_FAILED_502' }).message,
    ).toContain('一键启动');
    expect(
      describeRunFailure({ message: 'Failed to fetch' }).message,
    ).toContain('一键启动');
  });
  it('explains Pi startup and interrupted mutation without promising success', () => {
    expect(describeRunFailure({ code: 'PI_PROCESS_EXITED' }).message).toContain(
      'Pi',
    );
    expect(
      describeRunFailure({ code: 'RECOVERY_REQUIRES_RECONCILIATION' }).message,
    ).toContain('没有自动重做');
  });
});

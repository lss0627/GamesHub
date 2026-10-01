export interface RunFailureDetail {
  code?: string;
  message?: string;
}

export interface RunFailurePresentation {
  intent: 'out_of_scope' | 'error';
  title: string;
  message: string;
}

function contains(value: string, pattern: RegExp): boolean {
  return pattern.test(value.toUpperCase());
}

export function describeRunFailure(
  detail: RunFailureDetail,
  status = 'failed',
): RunFailurePresentation {
  const code = detail.code?.trim() ?? '';
  const message = detail.message?.trim() ?? '';
  const searchable = `${code} ${message}`;
  if (contains(searchable, /PROJECT_RUN_ACTIVE/))
    return {
      intent: 'error',
      title: '项目已有任务正在处理',
      message: '请等待当前任务完成，或刷新页面后查看、暂停或取消已有任务。',
    };
  if (contains(searchable, /IDEMPOTENCY_CONFLICT/))
    return {
      intent: 'error',
      title: '请求内容已变化',
      message: '这次请求标识已用于其他内容，请刷新任务状态后重新提交。',
    };

  if (status === 'cancelled') {
    return {
      intent: 'error',
      title: '本次创作已取消',
      message: '你可以调整描述后重新开始创作。',
    };
  }

  if (status === 'timed_out') {
    return {
      intent: 'error',
      title: '运行等待超时',
      message: '服务响应时间过长，请确认本地服务正常后重新尝试。',
    };
  }

  if (contains(searchable, /HTTP\s*402|INSUFFICIENT.*BALANCE/)) {
    return {
      intent: 'error',
      title: 'AI 模型额度不足',
      message:
        'DeepSeek 返回 HTTP 402（余额或额度不足）。请为当前 API Key 对应账户充值后重新尝试。',
    };
  }

  if (contains(searchable, /OUT_OF_SCOPE/)) {
    return {
      intent: 'out_of_scope',
      title: '这份方案还有尚未接入的玩法',
      message:
        '请回到玩法与方案查看具体缺口，继续和创作伙伴讨论第一版范围。已有游戏不会被替换。',
    };
  }

  if (
    contains(
      searchable,
      /PI_NOT_INSTALLED|PI_PROCESS_EXITED|PI_HOST_ERROR|PI_PROTOCOL/,
    )
  )
    return {
      intent: 'error',
      title: '创作伙伴未能启动',
      message:
        '请重新运行一键启动程序，它会检查 Pi 框架与依赖。已有项目和试玩版本仍会保留。',
    };
  if (
    contains(
      searchable,
      /PI_TIMEOUT|PI_BUDGET|AGENT_RETRY|AGENT_BUDGET|PI_OUTPUT_TRUNCATED/,
    )
  )
    return {
      intent: 'error',
      title: '这次制作需要继续调整',
      message:
        '创作伙伴已停止本轮尝试。可以先缩小这次修改，再确认制作说明；已发布版本仍可试玩。',
    };
  if (contains(searchable, /RECOVERY_REQUIRES_RECONCILIATION/))
    return {
      intent: 'error',
      title: '上次修改在执行中中断',
      message:
        '为避免重复修改工程，本次没有自动重做。请恢复一个已完成的版本，再重新确认制作。',
    };

  if (contains(searchable, /PROVIDER_ERROR|MODEL_PROVIDER/)) {
    return {
      intent: 'error',
      title: 'AI 模型服务暂时不可用',
      message: '请检查 DeepSeek 配置、账户状态与网络连接后重新尝试。',
    };
  }

  if (contains(searchable, /PREVIEW|PUBLISH/)) {
    return {
      intent: 'error',
      title: '游戏预览生成失败',
      message: '游戏处理未通过预览发布检查，请检查 Unity 构建日志后重试。',
    };
  }

  if (
    contains(
      searchable,
      /FAILED(?:_|\s+)TO(?:_|\s+)FETCH|NETWORK|RUN_(CREATE|STATUS)_FAILED|PROJECT_CREATE_FAILED/,
    )
  ) {
    return {
      intent: 'error',
      title: '无法连接创作服务',
      message: '请重新运行项目的一键启动程序，然后再试。',
    };
  }

  return {
    intent: 'error',
    title:
      status === 'partially_succeeded' ? '创作尚未全部完成' : '创作运行失败',
    message: code
      ? `错误代码：${code}。请检查服务日志后重新尝试。`
      : '请检查本地服务与运行日志后重新尝试。',
  };
}

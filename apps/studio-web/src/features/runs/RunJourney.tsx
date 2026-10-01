export interface RunJourneyEvent {
  sequence: number;
  type: string;
  payload: unknown;
  occurredAt?: string;
}

export type RunJourneyState = 'pending' | 'active' | 'complete' | 'failed';

export interface RunJourneyStep {
  id: string;
  title: string;
  description: string;
  output: string;
  state: RunJourneyState;
  evidenceCount: number;
  durationMs?: number;
  validation?: string;
  lastSequence?: number;
}

const taskCatalog: Record<
  string,
  Pick<RunJourneyStep, 'title' | 'description' | 'output'>
> = {
  'asset-import': {
    title: '导入选中的素材',
    description: '将确认的角色、背景、金币和障碍图片交给 Unity 检查并绑定。',
    output: '与制作说明一致的游戏素材',
  },
  'spec-validate': {
    title: '确认游戏方案',
    description: '检查玩法、数值和素材范围，确保方案能安全地交给 Unity。',
    output: '经过规则检查的游戏方案',
  },
  'scene-create': {
    title: '搭建游戏场景',
    description: '创建摄像机、地面、出生点和游戏运行需要的基础对象。',
    output: '可以启动的 Unity 场景',
  },
  'runtime-compose': {
    title: '组装核心玩法',
    description: '按已确认的游戏类型连接角色、交互、成长与胜负系统。',
    output: '与制作说明一致的可运行游戏',
  },
  'evaluate-game': {
    title: '核对玩法验收结果',
    description: '检查所选玩法的测试与证据，确认可以进入网页构建。',
    output: '玩法验收结论',
  },
  'player-create': {
    title: '创建玩家角色',
    description: '加入角色外观、移动、跳跃和碰撞能力。',
    output: '可控制的玩家角色',
  },
  'obstacles-create': {
    title: '加入障碍物',
    description: '配置障碍生成、移动速度和碰撞后的游戏规则。',
    output: '障碍物与碰撞逻辑',
  },
  'coins-create': {
    title: '加入金币与计分',
    description: '设置金币生成、收集反馈和分数增长方式。',
    output: '金币收集与计分系统',
  },
  'game-over-create': {
    title: '完成胜负流程',
    description: '补齐失败、结算和重新开始，让游戏形成完整循环。',
    output: '结算与重新开始流程',
  },
  'unity-tests': {
    title: '运行 Unity 自动检查',
    description: '编译工程并执行自动化测试，先排除脚本和场景错误。',
    output: 'Unity 编译与测试报告',
  },
  'playtest-run': {
    title: '检查玩法行为',
    description: '通过 Unity 行为测试或玩法探针检查交互、成长和胜负规则。',
    output: '玩法行为检查结果',
  },
  'evaluate-runner': {
    title: '评估游戏质量',
    description: '汇总测试证据，确认游戏达到可以交付试玩的标准。',
    output: '质量评估与问题清单',
  },
  'parameter-update': {
    title: '应用玩法修改',
    description: '只调整你提出的内容，并尽量保持其他玩法不变。',
    output: '更新后的游戏参数',
  },
  'targeted-playtest': {
    title: '复测修改内容',
    description: '针对这次修改重新试玩，确认没有破坏原有玩法。',
    output: '修改后的试玩结果',
  },
  'targeted-evaluate': {
    title: '复核修改质量',
    description: '检查修改结果、测试证据和剩余问题。',
    output: '本次修改的质量结论',
  },
  'build-web': {
    title: '构建网页游戏',
    description: '让 Unity 生成浏览器可以运行的 WebGL 游戏文件。',
    output: 'Unity WebGL 构建文件',
  },
  'publish-preview': {
    title: '发布试玩版本',
    description: '在真实浏览器检查当前构建，通过后生成可打开的试玩地址。',
    output: '可打开的游戏试玩链接',
  },
};

const createTasks = [
  'spec-validate',
  'scene-create',
  'player-create',
  'obstacles-create',
  'coins-create',
  'game-over-create',
  'unity-tests',
  'playtest-run',
  'evaluate-runner',
  'build-web',
  'publish-preview',
];

const changeTasks = [
  'parameter-update',
  'targeted-playtest',
  'targeted-evaluate',
  'build-web',
  'publish-preview',
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function eventActionId(event: RunJourneyEvent): string | undefined {
  const payload = record(event.payload);
  if (typeof payload.actionId === 'string') return payload.actionId;
  if (typeof payload.taskId === 'string') return payload.taskId;
  const input = record(payload.input);
  return typeof input.taskId === 'string' ? input.taskId : undefined;
}

function eventTime(event: RunJourneyEvent | undefined): number | undefined {
  if (!event?.occurredAt) return undefined;
  const value = Date.parse(event.occurredAt);
  return Number.isFinite(value) ? value : undefined;
}

function durationBetween(
  start: RunJourneyEvent | undefined,
  finish: RunJourneyEvent | undefined,
): number | undefined {
  const startedAt = eventTime(start);
  const finishedAt = eventTime(finish);
  return startedAt !== undefined && finishedAt !== undefined
    ? Math.max(0, finishedAt - startedAt)
    : undefined;
}

function fallbackTask(taskId: string) {
  const words = taskId.replaceAll('-', ' ');
  return {
    title: `处理 ${words}`,
    description: 'Agent 正在通过受控 Unity 工具完成这项工作。',
    output: '经过验证的 Unity 变更',
  };
}

export function buildRunJourney(input: {
  requestType: 'create' | 'modify' | 'rollback';
  phase: string;
  events: RunJourneyEvent[];
}): RunJourneyStep[] {
  const events = [...input.events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const accepted = events.find((event) => event.type === 'run.accepted');
  const runFailed = [...events]
    .reverse()
    .find((event) =>
      ['run.failed', 'agent.run.failed', 'agent.reflect.stopped'].includes(
        event.type,
      ),
    );
  const modelEvents = events.filter(
    (event) => eventActionId(event) === 'interpret-game-spec',
  );
  const modelStarted = modelEvents.find((event) =>
    ['agent.plan.action_ready', 'agent.act.started'].includes(event.type),
  );
  const modelFinished = [...modelEvents]
    .reverse()
    .find((event) =>
      ['agent.observe.completed', 'agent.observe.failed'].includes(event.type),
    );
  const modelFailed = modelFinished?.type === 'agent.observe.failed';
  const unityWorkStarted = events.some((event) => {
    const actionId = eventActionId(event);
    return actionId && actionId !== 'interpret-game-spec';
  });
  const modelComplete =
    modelFinished?.type === 'agent.observe.completed' ||
    (input.requestType === 'rollback' &&
      (unityWorkStarted || input.phase === 'succeeded'));
  const modelDuration = durationBetween(modelStarted, modelFinished);

  const requestStep: RunJourneyStep = {
    id: 'request-accepted',
    title: '接收你的创意',
    description: '保存本次需求，并为整次创作建立可追踪的运行记录。',
    output: '创作任务与独立 Trace ID',
    state: accepted
      ? 'complete'
      : input.phase === 'failed'
        ? 'failed'
        : input.phase === 'queued'
          ? 'pending'
          : 'complete',
    evidenceCount: accepted ? 1 : 0,
    ...(accepted ? { lastSequence: accepted.sequence } : {}),
  };

  const modelStep: RunJourneyStep = {
    id: 'interpret-game-spec',
    title: '理解并设计游戏',
    description:
      input.requestType === 'create'
        ? 'AI 把自然语言整理成角色、规则、关卡和数值明确的游戏方案。'
        : input.requestType === 'rollback'
          ? '读取目标历史版本，确定需要恢复的内容。'
          : '理解这次修改，并计算它与当前游戏之间的差异。',
    output:
      input.requestType === 'rollback'
        ? '待恢复的历史游戏方案'
        : '结构化 GameSpec 游戏方案',
    state: modelFailed
      ? 'failed'
      : modelComplete
        ? 'complete'
        : modelStarted
          ? 'active'
          : input.phase === 'failed' && accepted
            ? 'failed'
            : 'pending',
    evidenceCount: modelComplete ? 1 : 0,
    ...(modelDuration !== undefined ? { durationMs: modelDuration } : {}),
    ...(modelFinished
      ? { lastSequence: modelFinished.sequence }
      : modelStarted
        ? { lastSequence: modelStarted.sequence }
        : {}),
  };

  const expectedTasks =
    input.requestType === 'create' ? createTasks : changeTasks;
  const discoveredTasks = events.flatMap((event) => {
    const taskId = eventActionId(event);
    return taskId && taskId !== 'interpret-game-spec' ? [taskId] : [];
  });
  const taskIds = [...new Set([...expectedTasks, ...discoveredTasks])];
  const taskSteps = taskIds.map((taskId): RunJourneyStep => {
    const taskEvents = events.filter(
      (event) => eventActionId(event) === taskId,
    );
    const started = taskEvents.find((event) =>
      ['agent.plan.action_ready', 'agent.act.started'].includes(event.type),
    );
    const completion = [...taskEvents]
      .reverse()
      .find(
        (event) =>
          event.type === 'task.progress' ||
          event.type === 'agent.observe.completed' ||
          event.type === 'agent.observe.failed',
      );
    const completed =
      completion?.type === 'agent.observe.completed' ||
      (completion?.type === 'task.progress' &&
        record(completion.payload).status === 'completed');
    const failed =
      completion?.type === 'agent.observe.failed' ||
      (completion?.type === 'task.progress' &&
        record(completion.payload).status === 'failed');
    const metadata = taskCatalog[taskId] ?? fallbackTask(taskId);
    const progressEvent = [...taskEvents]
      .reverse()
      .find((event) => event.type === 'task.progress');
    const progressPayload = record(progressEvent?.payload);
    const planEvent = taskEvents.find(
      (event) => event.type === 'agent.plan.action_ready',
    );
    const planInput = record(record(planEvent?.payload).input);
    const validation =
      typeof planInput.validation === 'string'
        ? planInput.validation
        : undefined;
    const taskDuration = durationBetween(started, completion);
    return {
      id: taskId,
      ...metadata,
      state: failed
        ? 'failed'
        : completed
          ? 'complete'
          : started
            ? 'active'
            : 'pending',
      evidenceCount:
        typeof progressPayload.evidenceCount === 'number'
          ? progressPayload.evidenceCount
          : 0,
      ...(taskDuration !== undefined ? { durationMs: taskDuration } : {}),
      ...(validation ? { validation } : {}),
      ...(completion
        ? { lastSequence: completion.sequence }
        : started
          ? { lastSequence: started.sequence }
          : {}),
    };
  });

  if (
    runFailed &&
    !modelFailed &&
    !taskSteps.some((step) => step.state === 'failed')
  ) {
    const active = [...taskSteps]
      .reverse()
      .find((step) => step.state === 'active');
    if (active) active.state = 'failed';
    else if (modelStep.state === 'active' || modelStep.state === 'pending')
      modelStep.state = 'failed';
  }

  return [requestStep, modelStep, ...taskSteps];
}

function stateCopy(step: RunJourneyStep): string {
  if (step.state === 'complete')
    return step.evidenceCount > 0
      ? `已完成 · ${step.evidenceCount} 项验证证据`
      : '已完成';
  if (step.state === 'active') return '正在处理这一项';
  if (step.state === 'failed') return '这一步需要处理';
  return '等待前一步完成';
}

function formatDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined) return undefined;
  if (durationMs < 1000) return `${durationMs} 毫秒`;
  if (durationMs < 60_000)
    return `${Math.max(1, Math.round(durationMs / 1000))} 秒`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
}

export function RunJourney(props: {
  requestType: 'create' | 'modify' | 'rollback';
  phase: string;
  events: RunJourneyEvent[];
  traceId?: string;
  previewReady?: boolean;
}) {
  const steps = buildRunJourney(props);
  const completed = steps.filter((step) => step.state === 'complete').length;
  const active = steps.find((step) => step.state === 'active');
  const failed = steps.find((step) => step.state === 'failed');
  const headline =
    props.phase === 'queued' && props.events.length === 0
      ? '输入创意后，我们会按顺序完成并解释下面每一步'
      : failed
        ? `停在“${failed.title}”，展开这一步可以查看原因`
        : props.previewReady
          ? '全部步骤已经通过，游戏可以试玩了'
          : active
            ? `现在正在：${active.title}`
            : '准备开始下一步';

  return (
    <section className="panel run-journey" aria-labelledby="run-journey-title">
      <header className="run-journey__header">
        <span className="run-journey__intro">
          <small>CREATION JOURNEY / STEP BY STEP</small>
          <strong id="run-journey-title">这次游戏是怎样做出来的</strong>
          <span role="status" aria-live="polite">
            {headline}
          </span>
        </span>
        <span
          className="run-journey__count"
          role="status"
          aria-label={`${completed} 个步骤已完成`}
        >
          <strong>{completed.toString().padStart(2, '0')}</strong>
          <small>/ {steps.length.toString().padStart(2, '0')} STEPS</small>
        </span>
      </header>

      <ol className="run-journey__steps">
        {steps.map((step, index) => {
          const duration = formatDuration(step.durationMs);
          return (
            <li key={step.id} data-state={step.state}>
              <span className="run-journey__number" aria-hidden="true">
                {step.state === 'complete'
                  ? '✓'
                  : (index + 1).toString().padStart(2, '0')}
              </span>
              <span className="run-journey__step-copy">
                <span className="run-journey__step-heading">
                  <strong>{step.title}</strong>
                  <small>{stateCopy(step)}</small>
                </span>
                <span className="run-journey__description">
                  {step.description}
                </span>
                <span className="run-journey__output">
                  <span>产物</span>
                  <strong>{step.output}</strong>
                  {duration ? <small>耗时 {duration}</small> : null}
                </span>
                {step.state !== 'pending' ? (
                  <details className="run-journey__technical">
                    <summary>查看本步技术信息</summary>
                    <dl>
                      <div>
                        <dt>任务标识</dt>
                        <dd>{step.id}</dd>
                      </div>
                      <div>
                        <dt>验证方式</dt>
                        <dd>{step.validation ?? '平台状态检查'}</dd>
                      </div>
                      <div>
                        <dt>事件序号</dt>
                        <dd>{step.lastSequence ?? '执行中'}</dd>
                      </div>
                    </dl>
                  </details>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      <footer className="run-journey__footer">
        <span>
          <strong>看不懂技术名词也没关系。</strong>
          每一步都必须通过检查，最后才会出现可试玩版本。
        </span>
        <code>
          {props.traceId
            ? `TRACE ${props.traceId.slice(0, 12)}…`
            : 'TRACE 等待建立'}
        </code>
      </footer>
    </section>
  );
}

export function RunProgress(props: {
  phase: string;
  message: string;
  completedTasks: number;
  totalTasks: number;
  terminal?: boolean;
}) {
  const percentage =
    props.totalTasks > 0
      ? Math.round((props.completedTasks / props.totalTasks) * 100)
      : 0;
  const phaseLabels: Record<string, string> = {
    queued: 'READY',
    planning: 'PLANNING',
    testing: 'VALIDATING',
    succeeded: 'COMPLETE',
    failed: 'ATTENTION',
  };
  return (
    <section
      className="run-progress"
      aria-label="生成进度"
      data-phase={props.phase}
    >
      <progress className="sr-only" max={100} value={percentage}>
        {percentage}%
      </progress>
      <div className="run-progress__topline">
        <div className="run-progress__state">
          <span className="run-progress__state-dot" aria-hidden="true" />
          <p className="run-progress__message">{props.message}</p>
        </div>
        <span className="run-progress__phase">
          {phaseLabels[props.phase] ?? props.phase}
        </span>
      </div>
      <div className="run-progress__track" aria-hidden="true">
        <div
          className="run-progress__fill"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="run-progress__stats">
        <span>
          TASKS {props.completedTasks.toString().padStart(2, '0')} /{' '}
          {props.totalTasks.toString().padStart(2, '0')}
        </span>
        <span>
          {props.terminal
            ? props.phase === 'succeeded'
              ? '已完成'
              : '需要处理'
            : `${percentage}%`}
        </span>
      </div>
    </section>
  );
}

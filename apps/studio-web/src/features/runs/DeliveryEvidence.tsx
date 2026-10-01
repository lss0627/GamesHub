import type { RunJourneyEvent } from './RunJourney';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function deliverySummary(
  runId: string,
  phase: string,
  events: RunJourneyEvent[],
) {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const preparedEvent = ordered.findLast(
    (event) => event.type === 'run.delivery.prepared',
  );
  const prepared = record(preparedEvent?.payload);
  const success = ordered.findLast((event) => event.type === 'run.succeeded');
  const committed = record(success?.payload);
  const browser = record(prepared.browser);
  const buildMatches =
    typeof committed.previewId === 'string'
      ? committed.previewId === prepared.previewId
      : typeof committed.buildContentHash === 'string' &&
        committed.buildContentHash === prepared.buildHash;
  const verified =
    phase === 'succeeded' &&
    success &&
    preparedEvent &&
    success.sequence > preparedEvent.sequence &&
    prepared.runId === runId &&
    prepared.specVersionId === committed.specVersionId &&
    buildMatches &&
    browser.passed === true;
  const stopped = [
    'failed',
    'cancelled',
    'timed_out',
    'rejected',
    'partially_succeeded',
    'out_of_scope',
  ].includes(phase);
  const recoveryEvent = ordered.findLast((event) =>
    ['run.source.recovered', 'run.source.recovery_failed'].includes(event.type),
  );
  const recovery =
    recoveryEvent?.type === 'run.source.recovered'
      ? 'recovered'
      : recoveryEvent
        ? 'failed'
        : undefined;
  const tests = Array.isArray(prepared.tests) ? prepared.tests.map(record) : [];
  return {
    status: verified
      ? 'verified'
      : stopped
        ? 'failed'
        : phase === 'succeeded'
          ? 'unverified'
          : 'pending',
    recovery,
    tests,
    browser,
  };
}

const checkNames: Record<string, string> = {
  'load-and-identity': '加载与版本一致',
  'visible-canvas': '游戏画面可见',
  'creative-document': '场景、动画与声音版本一致',
  'creative-start': '创作内容随游戏启动',
  start: '开始游戏',
  'pause-and-resume': '暂停与继续',
  'core-interaction': '核心交互',
  'runtime-errors': '浏览器运行错误检查',
};
export function DeliveryEvidence({
  runId,
  phase,
  events,
}: {
  runId: string;
  phase: string;
  events: RunJourneyEvent[];
}) {
  const summary = deliverySummary(runId, phase, events);
  const criteria = summary.tests.flatMap((suite) =>
    Array.isArray(suite.criteria) ? suite.criteria.map(record) : [],
  );
  const legacy = summary.tests.some((suite) => suite.mode === 'legacy');
  const browserChecks = Array.isArray(summary.browser.checks)
    ? summary.browser.checks.map(record)
    : [];
  return (
    <section className="studio-delivery" aria-label="交付验收">
      <h4>
        {summary.status === 'verified'
          ? '本次交付已通过验证'
          : summary.status === 'unverified'
            ? '此版本暂无完整验收记录'
            : summary.status === 'failed'
              ? '本次未交付新版本'
              : '交付前检查进行中'}
      </h4>
      {summary.status === 'verified' && (
        <>
          <p>
            浏览器检查{' '}
            {browserChecks.filter((item) => item.status === 'passed').length}/
            {browserChecks.length} 项通过
            {criteria.length
              ? `，机制需求 ${criteria.filter((item) => item.status === 'passed').length}/${criteria.length} 项通过`
              : ''}
            。
          </p>
          <details>
            <summary>查看浏览器与需求验收</summary>
            <ul>
              {browserChecks.map((check) => (
                <li key={String(check.id)}>
                  {check.status === 'passed' ? '✓' : '!'}{' '}
                  {checkNames[String(check.id)] ?? '浏览器检查'}
                </li>
              ))}
            </ul>
            {criteria.length > 0 && (
              <div>
                <p>
                  机制需求验收（
                  {criteria.filter((item) => item.status === 'passed').length}/
                  {criteria.length}）
                </p>
                <ul>
                  {criteria.map((item) => (
                    <li key={String(item.id)}>
                      {item.status === 'passed' ? '✓' : '!'}{' '}
                      {String(item.description)} ·{' '}
                      {item.status === 'passed' ? '通过' : '未通过'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {legacy && <p>部分历史机制仅有整套测试记录，尚未逐条关联需求。</p>}
            <small>
              浏览器检查覆盖基础操作；机制效果由对应的 Unity 行为测试验证。
            </small>
          </details>
        </>
      )}
      {summary.status === 'unverified' && (
        <p>该版本仍可试玩；没有记录的检查不计为通过。</p>
      )}
      {summary.recovery === 'recovered' && (
        <p role="status">本次未完成的源码已归档，工程已恢复到制作前。</p>
      )}
      {summary.recovery === 'failed' && (
        <p role="alert">工程恢复尚未完成，下一次制作前会先重试恢复。</p>
      )}
    </section>
  );
}

export function RunOutcome(props: {
  status: 'succeeded' | 'partially_succeeded' | 'failed';
  unresolvedIssues: Array<{ id: string; description: string }>;
}) {
  const title =
    props.status === 'succeeded'
      ? '游戏已完成'
      : props.status === 'partially_succeeded'
        ? '游戏已生成，但仍有待处理问题'
        : '这次生成没有通过检查';
  return (
    <section className="run-outcome" aria-label="运行结果">
      <h2>{title}</h2>
      {props.unresolvedIssues.length > 0 ? (
        <ul>
          {props.unresolvedIssues.map((issue) => (
            <li key={issue.id}>{issue.description}</li>
          ))}
        </ul>
      ) : props.status === 'failed' ? (
        <p>请根据上方错误提示处理后重新尝试。</p>
      ) : props.status === 'partially_succeeded' ? (
        <p>仍有检查未通过，请处理后再次验证。</p>
      ) : (
        <p>所有关键检查均已通过。</p>
      )}
    </section>
  );
}

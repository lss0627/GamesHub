export function RevisionMessage(props: {
  intent: 'modify' | 'out_of_scope' | 'accepted' | 'error';
  summary: string;
}) {
  const message =
    props.intent === 'out_of_scope'
      ? '这个请求超出了当前 Runner 范围。你可以继续调整玩法参数或素材。'
      : props.intent === 'modify'
        ? '已识别为局部修改，平台会保留现有游戏并运行受影响的检查。'
        : props.summary;
  return (
    <p className="system-message" role="status" data-intent={props.intent}>
      {message}
    </p>
  );
}

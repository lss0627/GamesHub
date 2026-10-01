export type ChangeIntent = 'create' | 'modify' | 'out_of_scope';

export function classifyChangeIntent(
  prompt: string,
  hasCurrentSpec = false,
): ChangeIntent {
  if (
    /多人|联机|multiplayer|mmo|3d|三维|主机|console|新敌人|new enemy/i.test(
      prompt,
    )
  )
    return 'out_of_scope';
  if (
    hasCurrentSpec &&
    /改|调整|修改|换成|提高|降低|跳(?:跃|得)?|金币.*(?:分数|得分)|score|change|adjust|update|set|replace/i.test(
      prompt,
    )
  )
    return 'modify';
  return 'create';
}

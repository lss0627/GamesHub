export interface CreatorProgress {
  runId: string;
  phase:
    | 'queued'
    | 'planning'
    | 'building'
    | 'testing'
    | 'publishing'
    | 'paused'
    | 'succeeded'
    | 'failed';
  message: string;
  completedTasks: number;
  totalTasks: number;
  terminal: boolean;
}

export function projectCreatorProgress(event: {
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
}): CreatorProgress {
  const phase = event.eventType.includes('paused')
    ? 'paused'
    : event.eventType.includes('published') ||
        event.eventType.includes('succeeded')
      ? 'succeeded'
      : event.eventType.includes('failed') ||
          event.eventType.includes('cancelled')
        ? 'failed'
        : event.eventType.includes('test') ||
            event.eventType.includes('playtest')
          ? 'testing'
          : event.eventType.includes('build') ||
              event.eventType.includes('execute')
            ? 'building'
            : event.eventType.includes('plan')
              ? 'planning'
              : 'queued';
  const totalTasks =
    typeof event.payload.total_tasks === 'number'
      ? event.payload.total_tasks
      : 0;
  const completedTasks =
    typeof event.payload.completed_tasks === 'number'
      ? event.payload.completed_tasks
      : 0;
  return {
    runId: event.runId,
    phase,
    message:
      typeof event.payload.message === 'string'
        ? event.payload.message
        : event.eventType,
    completedTasks,
    totalTasks,
    terminal: ['succeeded', 'failed'].includes(phase),
  };
}

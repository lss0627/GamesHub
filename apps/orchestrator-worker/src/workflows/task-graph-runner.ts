import {
  type PlannedTaskGraph,
  type PlannerTask,
  readyTasks,
} from '@gamerhub/game-planner';

export interface TaskExecutionResult<TEvidence = string, TError = string> {
  taskId: string;
  status: 'completed' | 'failed' | 'cancelled';
  evidence: TEvidence[];
  error?: TError;
}

export class TaskGraphRunner<TEvidence = string, TError = string> {
  constructor(private readonly graph: PlannedTaskGraph) {}

  next(): PlannerTask[] {
    return readyTasks(this.graph);
  }

  async execute(
    executor: (
      task: PlannerTask,
    ) => Promise<TaskExecutionResult<TEvidence, TError>>,
  ): Promise<TaskExecutionResult<TEvidence, TError>[]> {
    const results: TaskExecutionResult<TEvidence, TError>[] = [];
    while (this.next().length > 0) {
      const batch = this.next();
      for (const task of batch) {
        task.status = 'running';
        const result = await executor(task);
        if (result.taskId !== task.id) throw new Error('TASK_RESULT_MISMATCH');
        results.push(result);
        task.status = result.status;
        if (result.status !== 'completed') return results;
      }
    }
    if (this.graph.tasks.some((task) => task.status !== 'completed'))
      throw new Error('TASK_GRAPH_INCOMPLETE');
    return results;
  }
}

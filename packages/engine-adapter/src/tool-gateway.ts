import type {
  EngineAdapter,
  EngineCommand,
  EngineCommandResult,
  EngineExecutionContext,
} from './index';
import { EngineAdapterError, validateEngineCommand } from './index';

export interface ToolDefinition {
  name: string;
  capability: string;
  safetyClass: EngineCommand['safetyClass'];
  validate?: (argumentsValue: Record<string, unknown>) => void;
}

export class GameToolGateway {
  private readonly tools = new Map<string, ToolDefinition>();
  constructor(private readonly adapter: EngineAdapter) {}
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }
  async invoke(
    name: string,
    command: Omit<EngineCommand, 'capability' | 'safetyClass'> & {
      arguments: Record<string, unknown>;
    },
    ctx: EngineExecutionContext,
  ): Promise<EngineCommandResult> {
    const tool = this.tools.get(name);
    if (!tool || !ctx.capabilities.includes(tool.capability))
      throw new EngineAdapterError(
        'COMMAND_NOT_ALLOWED',
        `Tool ${name} is not authorized`,
      );
    tool.validate?.(command.arguments);
    const normalized: EngineCommand = {
      ...command,
      capability: tool.capability,
      safetyClass: tool.safetyClass,
    };
    validateEngineCommand(normalized);
    return this.adapter.execute(normalized, ctx);
  }
}

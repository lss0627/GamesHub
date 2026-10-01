import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EngineCommandResult } from '@gamerhub/engine-adapter';
import { EngineAdapterError } from '@gamerhub/engine-adapter';
import { type NUnitReport, parseNUnitReport } from './nunit-report';

export interface UnityProcessRequest {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface UnityProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  aborted?: boolean;
  durationMs?: number;
}

export type UnityProcessRunner = (
  request: UnityProcessRequest,
) => Promise<UnityProcessResult>;

interface ActiveOperation {
  method: string;
  controller: AbortController;
  cleanupPath?: string;
}

const allowlistedMethods = new Set([
  'GamerHub.AgentBridge.Editor.BatchmodeMethods.Compile',
  'GamerHub.AgentBridge.Editor.BatchmodeMethods.BuildWeb',
  'GamerHub.AgentBridge.Editor.BatchmodeMethods.ApplyParameter',
  'GamerHub.AgentBridge.Editor.BatchmodeMethods.CreateScene',
  'GamerHub.AgentBridge.Editor.BatchmodeMethods.ImportAsset',
]);

function parseOutput(stdout: string): Record<string, unknown> {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();
  for (const line of lines) {
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value))
        return value as Record<string, unknown>;
    } catch {
      // Unity writes human-readable progress before the final JSON envelope.
    }
  }
  return {};
}

function safeArgument(value: string): string {
  if (
    !value ||
    value.includes('\0') ||
    value.includes('\r') ||
    value.includes('\n')
  )
    throw new EngineAdapterError(
      'COMMAND_ARGUMENT_INVALID',
      'Batchmode arguments may not contain control characters',
    );
  return value;
}

export async function runUnityProcess(
  request: UnityProcessRequest,
): Promise<UnityProcessResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (result: UnityProcessResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ...result, durationMs: Date.now() - started });
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      finish({ exitCode: null, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on('close', (exitCode) => finish({ exitCode, stdout, stderr }));
    const kill = (): void => {
      if (process.platform === 'win32' && child.pid)
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          shell: false,
          windowsHide: true,
          stdio: 'ignore',
        });
      else child.kill('SIGTERM');
    };
    if (request.signal.aborted) {
      kill();
      finish({ exitCode: null, stdout, stderr, aborted: true });
      return;
    }
    request.signal.addEventListener(
      'abort',
      () => {
        kill();
        finish({ exitCode: null, stdout, stderr, aborted: true });
      },
      { once: true },
    );
    timer = setTimeout(() => {
      kill();
      finish({ exitCode: null, stdout, stderr, timedOut: true });
    }, request.timeoutMs);
  });
}

export class UnityBatchmodeRunner {
  private readonly active = new Map<string, ActiveOperation>();
  private readonly editorPath: string | undefined;
  private readonly projectPath: string | undefined;
  private readonly processRunner: UnityProcessRunner;

  constructor(
    options: {
      editorPath?: string;
      projectPath?: string;
      processRunner?: UnityProcessRunner;
      defaultTimeoutMs?: number;
    } = {},
  ) {
    this.editorPath = options.editorPath;
    this.projectPath = options.projectPath;
    this.processRunner = options.processRunner ?? runUnityProcess;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 20 * 60 * 1000;
  }

  private readonly defaultTimeoutMs: number;

  async run(
    method: string,
    args: Record<string, string>,
    options: {
      timeoutMs?: number;
      traceContext?: { traceId: string; spanId: string };
    } = {},
  ): Promise<EngineCommandResult> {
    if (!allowlistedMethods.has(method))
      throw new EngineAdapterError(
        'COMMAND_NOT_ALLOWED',
        `Batchmode method ${method} is not allowlisted`,
      );
    if (!this.editorPath || !this.projectPath)
      throw new EngineAdapterError(
        'ENGINE_UNAVAILABLE',
        'UNITY_EDITOR_PATH and UNITY_GOLDEN_PROJECT are required for batchmode',
        true,
      );
    const operationId = randomUUID();
    const controller = new AbortController();
    this.active.set(operationId, { method, controller });
    const serializedArgs = Object.entries(args).flatMap(([key, value]) => [
      `-gamerhub-${safeArgument(key)}`,
      safeArgument(value),
    ]);
    const serializedTrace = options.traceContext
      ? [
          '-gamerhub-traceId',
          safeArgument(options.traceContext.traceId),
          '-gamerhub-spanId',
          safeArgument(options.traceContext.spanId),
        ]
      : [];
    let result: UnityProcessResult;
    try {
      result = await this.processRunner({
        command: this.editorPath,
        args: [
          '-batchmode',
          '-quit',
          '-nographics',
          '-projectPath',
          safeArgument(this.projectPath),
          '-executeMethod',
          method,
          '-logFile',
          '-',
          ...serializedTrace,
          ...serializedArgs,
        ],
        cwd: this.projectPath,
        timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
        signal: controller.signal,
      });
    } finally {
      this.active.delete(operationId);
    }
    const output = parseOutput(result.stdout);
    const failed =
      result.exitCode !== 0 ||
      result.timedOut ||
      result.aborted ||
      /\b(error|exception)\b/i.test(result.stderr);
    return {
      operationId,
      status: result.aborted ? 'cancelled' : failed ? 'failed' : 'succeeded',
      output: {
        ...output,
        stdout: result.stdout.slice(-20_000),
        stderr: result.stderr.slice(-20_000),
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        transport: 'batchmode',
      },
      changedFiles: [],
      warnings: [],
      errors: failed
        ? [
            {
              code: result.timedOut
                ? 'ENGINE_TIMEOUT'
                : 'ENGINE_PROCESS_FAILED',
              message: result.timedOut
                ? 'Unity batchmode exceeded its deadline'
                : 'Unity batchmode exited with a failure',
              severity: 'error',
            },
          ]
        : [],
      evidenceRefs: [],
      retryable: Boolean(result.timedOut || result.aborted),
    };
  }

  async runTests(
    mode: 'editmode' | 'playmode',
    filter = '',
    options: {
      timeoutMs?: number;
      traceContext?: { traceId: string; spanId: string };
    } = {},
  ): Promise<EngineCommandResult> {
    if (!this.editorPath || !this.projectPath)
      throw new EngineAdapterError(
        'ENGINE_UNAVAILABLE',
        'UNITY_EDITOR_PATH and UNITY_GOLDEN_PROJECT are required for batchmode',
        true,
      );
    const operationId = randomUUID();
    const controller = new AbortController();
    const resultsDirectory = resolve(
      this.projectPath,
      '.gamerhub',
      'test-results',
    );
    mkdirSync(resultsDirectory, { recursive: true });
    const testResultsPath = resolve(resultsDirectory, `${operationId}.xml`);
    this.active.set(operationId, {
      method: 'UnityTestRunner',
      controller,
    });
    const serializedFilter = filter
      ? ['-testFilter', safeArgument(filter)]
      : [];
    const testPlatform = mode === 'editmode' ? 'EditMode' : 'PlayMode';
    const serializedTrace = options.traceContext
      ? [
          '-gamerhub-traceId',
          safeArgument(options.traceContext.traceId),
          '-gamerhub-spanId',
          safeArgument(options.traceContext.spanId),
        ]
      : [];
    let result: UnityProcessResult;
    try {
      result = await this.processRunner({
        command: this.editorPath,
        args: [
          '-batchmode',
          '-nographics',
          '-projectPath',
          safeArgument(this.projectPath),
          '-runTests',
          '-testPlatform',
          testPlatform,
          '-testResults',
          safeArgument(testResultsPath),
          ...serializedTrace,
          ...serializedFilter,
          '-logFile',
          '-',
        ],
        cwd: this.projectPath,
        timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
        signal: controller.signal,
      });
      const output = parseOutput(result.stdout);
      let report: NUnitReport | undefined;
      let reportInvalid = false;
      let reportHash: string | undefined;
      const hasTestResults = existsSync(testResultsPath);
      if (hasTestResults) {
        const xml = readFileSync(testResultsPath, 'utf8');
        reportHash = `sha256-${createHash('sha256').update(xml).digest('hex')}`;
        try {
          report = parseNUnitReport(xml);
        } catch {
          reportInvalid = true;
        }
      }
      const testFailed = Boolean(
        report && (report.failed > 0 || report.result !== 'Passed'),
      );
      const processFailed =
        result.exitCode !== 0 ||
        result.timedOut ||
        result.aborted ||
        !hasTestResults ||
        reportInvalid ||
        /\b(error|exception)\b/i.test(result.stderr);
      return {
        operationId,
        status: result.aborted
          ? 'cancelled'
          : processFailed || testFailed
            ? 'failed'
            : 'succeeded',
        output: {
          ...output,
          passed: report?.passed ?? 0,
          failed: report?.failed ?? (processFailed ? 1 : 0),
          testCases: report?.cases ?? [],
          ...(reportHash
            ? {
                testReport: {
                  relativePath: `.gamerhub/test-results/${operationId}.xml`,
                  contentHash: reportHash,
                },
              }
            : {}),
          stdout: result.stdout.slice(-20_000),
          stderr: result.stderr.slice(-20_000),
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          transport: 'batchmode',
        },
        changedFiles: [],
        warnings: [],
        errors:
          processFailed || testFailed
            ? [
                {
                  code: result.timedOut
                    ? 'ENGINE_TIMEOUT'
                    : reportInvalid
                      ? 'UNITY_TEST_REPORT_INVALID'
                      : testFailed
                        ? 'UNITY_TEST_FAILED'
                        : !hasTestResults
                          ? 'UNITY_TEST_RESULTS_MISSING'
                          : 'ENGINE_PROCESS_FAILED',
                  message: result.timedOut
                    ? 'Unity batchmode exceeded its deadline'
                    : reportInvalid
                      ? 'Unity test report could not be verified'
                      : !hasTestResults
                        ? 'Unity Test Framework did not produce a results file'
                        : 'Unity Test Framework reported a failure',
                  severity: 'error',
                },
              ]
            : [],
        evidenceRefs: [],
        retryable: Boolean(result.timedOut || result.aborted),
      };
    } finally {
      this.active.delete(operationId);
    }
  }

  async cancel(operationId: string): Promise<void> {
    this.active.get(operationId)?.controller.abort();
  }

  async cleanup(): Promise<{ orphanProcesses: number; cleaned: boolean }> {
    const orphanProcesses = this.active.size;
    for (const operation of this.active.values()) operation.controller.abort();
    this.active.clear();
    return { orphanProcesses, cleaned: true };
  }
}

export { allowlistedMethods };

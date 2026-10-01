import { randomUUID } from 'node:crypto';

export type ProbeStatus =
  | 'ok'
  | 'rejected'
  | 'timeout'
  | 'unsupported'
  | 'infra_error';

export interface ProbeResponse {
  request_id: string;
  sequence: number;
  status: ProbeStatus;
  simulation_tick: number;
  result: Record<string, unknown>;
  evidence_ids: string[];
}

export interface ProbeHandshakeInput {
  protocol_version: string;
  project_revision: string;
  game_spec_version: string;
  run_id?: string;
  seed?: number;
  fixed_delta_time_ms?: number;
}

export interface ProbeCommandInput {
  session_id: string;
  request_id: string;
  sequence: number;
  command: string;
  arguments: Record<string, unknown>;
  deadline_ms: number;
}

export interface ProbeTransport {
  handshake(
    input: ProbeHandshakeInput,
    signal?: AbortSignal,
  ): Promise<{
    session_id: string;
    capabilities: string[];
  }>;
  send(input: ProbeCommandInput, signal?: AbortSignal): Promise<ProbeResponse>;
  close?(sessionId: string): Promise<void>;
}

export interface HttpProbeTransportOptions {
  endpoint: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
}

export class PlaytestProtocolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PlaytestProtocolError';
    this.code = code;
  }
}

function probeUrl(endpoint: string, suffix: string): string {
  return `${endpoint.replace(/\/$/, '')}${suffix}`;
}

function probeHeaders(apiKey: string | undefined): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export class HttpProbeTransport implements ProbeTransport {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultTimeoutMs: number;

  constructor(options: HttpProbeTransportOptions) {
    if (
      !options.endpoint.startsWith('http://') &&
      !options.endpoint.startsWith('https://')
    )
      throw new PlaytestProtocolError(
        'CONFIG_INVALID',
        'Probe endpoint must be HTTP(S)',
      );
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5000;
  }

  handshake(input: ProbeHandshakeInput, signal?: AbortSignal) {
    return this.request('/handshake', input, signal).then((body) => {
      const sessionId =
        typeof body.session_id === 'string' ? body.session_id : undefined;
      const capabilities = Array.isArray(body.capabilities)
        ? body.capabilities.filter(
            (item): item is string => typeof item === 'string',
          )
        : [];
      if (!sessionId)
        throw new PlaytestProtocolError(
          'PROBE_INVALID',
          'Probe did not return a session id',
        );
      return { session_id: sessionId, capabilities };
    });
  }

  send(input: ProbeCommandInput, signal?: AbortSignal): Promise<ProbeResponse> {
    return this.request('/commands', input, signal).then((body) => {
      if (
        typeof body.request_id !== 'string' ||
        typeof body.sequence !== 'number' ||
        typeof body.simulation_tick !== 'number' ||
        !Array.isArray(body.evidence_ids)
      )
        throw new PlaytestProtocolError(
          'PROBE_INVALID',
          'Probe response envelope is invalid',
        );
      const status = body.status;
      if (
        !['ok', 'rejected', 'timeout', 'unsupported', 'infra_error'].includes(
          String(status),
        )
      )
        throw new PlaytestProtocolError(
          'PROBE_INVALID',
          'Probe returned an unknown status',
        );
      return {
        request_id: body.request_id,
        sequence: body.sequence,
        status: status as ProbeStatus,
        simulation_tick: body.simulation_tick,
        result: record(body.result),
        evidence_ids: body.evidence_ids.filter(
          (item): item is string => typeof item === 'string',
        ),
      };
    });
  }

  async close(sessionId: string): Promise<void> {
    await this.request(
      `/sessions/${encodeURIComponent(sessionId)}`,
      {},
      undefined,
      'DELETE',
    );
  }

  private async request(
    suffix: string,
    payload: unknown,
    externalSignal?: AbortSignal,
    method = 'POST',
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    externalSignal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), this.defaultTimeoutMs);
    try {
      const response = await this.fetchImpl(probeUrl(this.endpoint, suffix), {
        method,
        headers: probeHeaders(this.apiKey),
        ...(method === 'GET' ? {} : { body: JSON.stringify(payload) }),
        signal: controller.signal,
      });
      const text = await response.text();
      let body: unknown = {};
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new PlaytestProtocolError(
            'PROBE_INVALID',
            'Probe returned malformed JSON',
          );
        }
      }
      if (!response.ok)
        throw new PlaytestProtocolError(
          response.status >= 500 ? 'PROBE_INFRA_ERROR' : 'PROBE_REJECTED',
          `Probe returned HTTP ${response.status}`,
        );
      return record(body);
    } catch (error) {
      if (error instanceof PlaytestProtocolError) throw error;
      throw new PlaytestProtocolError(
        externalSignal?.aborted ? 'CANCELLED' : 'PROBE_TIMEOUT',
        externalSignal?.aborted
          ? 'Playtest was cancelled'
          : 'Probe transport timed out',
      );
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abort);
    }
  }
}

export class PlaytestProtocolClient {
  readonly executedCommands: string[] = [];
  private sequence = 0;
  private simulationTick = 0;
  private connected = false;
  private sessionId: string | undefined;
  private readonly transport: ProbeTransport | undefined;
  constructor(
    private readonly expected: {
      projectRevision: string;
      gameSpecVersion: string;
      protocolVersion?: string;
    },
    options: { transport?: ProbeTransport } = {},
  ) {
    this.transport = options.transport;
  }

  async handshake(input: {
    protocol_version: string;
    project_revision: string;
    game_spec_version: string;
    run_id?: string;
    seed?: number;
    fixed_delta_time_ms?: number;
    signal?: AbortSignal;
  }): Promise<{ session_id: string; capabilities: string[] }> {
    if (
      input.protocol_version !== (this.expected.protocolVersion ?? '1.0.0') ||
      input.project_revision !== this.expected.projectRevision ||
      input.game_spec_version !== this.expected.gameSpecVersion
    )
      throw new PlaytestProtocolError(
        'PROTOCOL_MISMATCH',
        'Probe protocol, project revision or spec version does not match',
      );
    const response = this.transport
      ? await this.transport.handshake(input, input.signal)
      : {
          session_id: randomUUID(),
          capabilities: [
            'input.action',
            'state.entity',
            'time.advance',
            'frame.capture',
          ],
        };
    this.sessionId = response.session_id;
    this.connected = true;
    return response;
  }

  async send(
    command: string,
    arguments_: Record<string, unknown> = {},
    deadlineMs = 5000,
    signal?: AbortSignal,
  ): Promise<ProbeResponse> {
    if (!this.connected)
      throw new PlaytestProtocolError(
        'HANDSHAKE_REQUIRED',
        'Probe handshake is required',
      );
    if (signal?.aborted)
      throw new PlaytestProtocolError('CANCELLED', 'Playtest was cancelled');
    if (deadlineMs <= 0)
      throw new PlaytestProtocolError(
        'DEADLINE_EXCEEDED',
        'Playtest command deadline must be positive',
      );
    const allowed =
      /^(input\.(press|release|move|jump|shoot|click)|time\.(wait|freeze|advance)|game\.restart|state\.(scene|entity|query|player|collision|animation)|frame\.capture)$/.test(
        command,
      );
    const request_id = randomUUID();
    const sequence = ++this.sequence;
    this.executedCommands.push(command);
    if (!allowed)
      return {
        request_id,
        sequence,
        status: 'unsupported',
        simulation_tick: this.simulationTick,
        result: {},
        evidence_ids: [],
      };
    if (this.transport) {
      const response = await this.transport.send(
        {
          session_id: this.sessionId ?? '',
          request_id,
          sequence,
          command,
          arguments: arguments_,
          deadline_ms: deadlineMs,
        },
        signal,
      );
      if (response.request_id !== request_id || response.sequence < sequence)
        throw new PlaytestProtocolError(
          'PROBE_SEQUENCE_INVALID',
          'Probe response sequence is invalid',
        );
      this.sequence = Math.max(this.sequence, response.sequence);
      this.simulationTick = response.simulation_tick;
      return response;
    }
    const duration =
      typeof arguments_.duration_ms === 'number'
        ? Math.max(0, arguments_.duration_ms)
        : 0;
    if (command.startsWith('time.'))
      this.simulationTick += Math.ceil(duration / 20);
    return {
      request_id,
      sequence,
      status: 'ok',
      simulation_tick: this.simulationTick,
      result: { command },
      evidence_ids: [randomUUID()],
    };
  }

  async close(): Promise<void> {
    if (this.sessionId && this.transport?.close)
      await this.transport.close(this.sessionId);
    this.connected = false;
    this.sessionId = undefined;
  }
}

export function classifyPlaytestFailure(
  error: unknown,
): 'infra_error' | 'game_error' | 'cancelled' {
  const message =
    error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/cancel|abort/i.test(message)) return 'cancelled';
  if (/disconnect|timeout|deadline|focus|transport|infra/i.test(message))
    return 'infra_error';
  return 'game_error';
}

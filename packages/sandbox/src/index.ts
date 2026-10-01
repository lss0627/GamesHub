import { randomUUID } from 'node:crypto';

export interface SandboxReservationRequest {
  runId: string;
  projectId: string;
  editorVersion: string;
  capabilities: string[];
  idempotencyKey: string;
  resourceProfile?: Record<string, unknown>;
  maximumDurationSeconds?: number;
  workspaceSnapshot?: string;
  packageLockHash?: string;
  container?: {
    image: string;
    projectPath: string;
    assetsPath: string;
    buildPath: string;
    workspacePath?: string;
  };
}
export interface SandboxReservation {
  reservationId: string;
  status: 'reserved' | 'waiting_for_license' | 'cancelled';
  runId: string;
  workerId?: string | undefined;
  licenseId?: string | undefined;
  containerId?: string | undefined;
  activationRef?: string | undefined;
}
export interface SandboxHandle {
  handleId: string;
  reservationId: string;
  runId: string;
  workerId: string;
  licenseId: string;
  status: 'active';
  containerId?: string | undefined;
  activationRef?: string | undefined;
  expiresAt?: string | undefined;
}
export interface SandboxReleaseResult {
  status: 'released' | 'quarantined';
  editorStopped: boolean;
  childProcessesStopped: boolean;
  licenseReturned: boolean;
  workspaceSealed: boolean;
  evidenceFlushed: boolean;
  cleanupErrors: Array<{ code: string; message: string }>;
}
export interface LicensedSandboxScheduler {
  reserve(request: SandboxReservationRequest): Promise<SandboxReservation>;
  activate(reservationId: string): Promise<SandboxHandle>;
  renew(handleId: string, ttlSeconds: number): Promise<void>;
  cancel(handleId: string, reason: string): Promise<void>;
  release(
    handleId: string,
    options?: { editorStopped?: boolean },
  ): Promise<SandboxReleaseResult>;
  reconcile(): Promise<{ recovered: number; quarantined: number }>;
}

export class InMemoryLicensedScheduler implements LicensedSandboxScheduler {
  private readonly reservations = new Map<
    string,
    SandboxReservation & { request: SandboxReservationRequest }
  >();
  private readonly handles = new Map<string, SandboxHandle>();
  private readonly idempotency = new Map<string, string>();
  private readonly workers: string[];
  private readonly licenses: string[];
  private readonly limit: number;
  constructor(options: {
    workerCount: number;
    licenseCount: number;
    concurrencyLimit: number;
  }) {
    this.workers = Array.from(
      { length: options.workerCount },
      (_, i) => `worker-${i + 1}`,
    );
    this.licenses = Array.from(
      { length: options.licenseCount },
      (_, i) => `license-${i + 1}`,
    );
    this.limit = options.concurrencyLimit;
  }
  async reserve(
    request: SandboxReservationRequest,
  ): Promise<SandboxReservation> {
    const priorId = this.idempotency.get(request.idempotencyKey);
    if (priorId) {
      const prior = this.reservations.get(priorId);
      if (prior) return { ...prior };
    }
    const active =
      [...this.reservations.values()].filter(
        (item) => item.status === 'reserved',
      ).length + this.handles.size;
    const status =
      active >= Math.min(this.limit, this.licenses.length, this.workers.length)
        ? 'waiting_for_license'
        : 'reserved';
    const reservation: SandboxReservation & {
      request: SandboxReservationRequest;
    } = {
      reservationId: randomUUID(),
      status: status as SandboxReservation['status'],
      runId: request.runId,
      workerId:
        status === 'reserved'
          ? this.workers[active % this.workers.length]
          : undefined,
      licenseId:
        status === 'reserved'
          ? this.licenses[active % this.licenses.length]
          : undefined,
      request,
    };
    this.reservations.set(reservation.reservationId, reservation);
    this.idempotency.set(request.idempotencyKey, reservation.reservationId);
    return { ...reservation };
  }
  async activate(reservationId: string): Promise<SandboxHandle> {
    const reservation = this.reservations.get(reservationId);
    if (
      reservation?.status !== 'reserved' ||
      !reservation.workerId ||
      !reservation.licenseId
    )
      throw new Error('LICENSE_UNAVAILABLE');
    const handle = {
      handleId: randomUUID(),
      reservationId,
      runId: reservation.runId,
      workerId: reservation.workerId,
      licenseId: reservation.licenseId,
      status: 'active' as const,
    };
    this.handles.set(handle.handleId, handle);
    return { ...handle };
  }
  async renew(handleId: string, ttlSeconds: number): Promise<void> {
    if (!this.handles.has(handleId) || ttlSeconds <= 0)
      throw new Error('LEASE_NOT_FOUND');
  }
  async cancel(handleId: string, _reason: string): Promise<void> {
    this.handles.delete(handleId);
  }
  async release(
    handleId: string,
    options: { editorStopped?: boolean } = {},
  ): Promise<SandboxReleaseResult> {
    const handle = this.handles.get(handleId);
    if (!handle)
      return {
        status: 'released',
        editorStopped: true,
        childProcessesStopped: true,
        licenseReturned: true,
        workspaceSealed: true,
        evidenceFlushed: true,
        cleanupErrors: [],
      };
    this.handles.delete(handleId);
    const stopped = options.editorStopped ?? true;
    return {
      status: stopped ? 'released' : 'quarantined',
      editorStopped: stopped,
      childProcessesStopped: stopped,
      licenseReturned: stopped,
      workspaceSealed: stopped,
      evidenceFlushed: stopped,
      cleanupErrors: stopped
        ? []
        : [
            {
              code: 'EDITOR_STILL_RUNNING',
              message: 'Editor process did not reach quiescence',
            },
          ],
    };
  }
  async reconcile() {
    return { recovered: 0, quarantined: 0 };
  }
}

export * from './container-runner';
export * from './license-broker';
export * from './license-repository';
export * from './licensed-scheduler';
export * from './workspace-provider';

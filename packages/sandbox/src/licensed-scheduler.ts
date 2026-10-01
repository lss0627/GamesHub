import { randomUUID } from 'node:crypto';
import type { ContainerRunner } from './container-runner';
import type {
  SandboxHandle,
  SandboxReleaseResult,
  SandboxReservation,
  SandboxReservationRequest,
} from './index';
import type { LicenseBroker } from './license-broker';

interface WorkerInput {
  id: string;
  status?: 'ready' | 'active' | 'quarantined' | 'offline';
  editorVersion?: string;
  capabilities?: string[];
}
interface LicenseInput {
  id: string;
  concurrencyLimit: number;
  status?: 'active' | 'expired' | 'quarantined';
  expiresAt?: string;
}

export class LicensedScheduler {
  private readonly reservations = new Map<
    string,
    SandboxReservation & { request: SandboxReservationRequest }
  >();
  private readonly handles = new Map<string, SandboxHandle>();
  private readonly activeReservationIds = new Set<string>();
  private readonly workers: Array<
    WorkerInput & { status: NonNullable<WorkerInput['status']> }
  >;
  private readonly licenses: Array<
    LicenseInput & { status: NonNullable<LicenseInput['status']> }
  >;
  private readonly containerRunner: ContainerRunner | undefined;
  private readonly licenseBroker: LicenseBroker | undefined;
  private readonly requireSignedDecision: boolean;
  private readonly decision:
    | {
        decisionRef: string;
        approvedCapacity: number;
        expiresAt: string;
      }
    | undefined;
  constructor(input: {
    workers: WorkerInput[];
    licenses: LicenseInput[];
    containerRunner?: ContainerRunner;
    licenseBroker?: LicenseBroker;
    requireSignedDecision?: boolean;
    decision?: {
      decisionRef: string;
      approvedCapacity: number;
      expiresAt: string;
    };
  }) {
    this.workers = input.workers.map((worker) => ({
      ...worker,
      status: worker.status ?? 'ready',
    }));
    this.licenses = input.licenses.map((license) => ({
      ...license,
      status: license.status ?? 'active',
    }));
    this.containerRunner = input.containerRunner;
    this.licenseBroker = input.licenseBroker;
    this.requireSignedDecision =
      input.requireSignedDecision ?? process.env.NODE_ENV === 'production';
    this.decision = input.decision;
    if (this.requireSignedDecision) {
      if (!this.decision?.decisionRef.startsWith('signed://'))
        throw new Error('UNITY_LICENSE_DECISION_REQUIRED');
      if (
        !Number.isInteger(this.decision.approvedCapacity) ||
        this.decision.approvedCapacity < 1
      )
        throw new Error('UNITY_LICENSE_CAPACITY_REQUIRED');
      if (
        !Number.isFinite(Date.parse(this.decision.expiresAt)) ||
        Date.parse(this.decision.expiresAt) <= Date.now()
      )
        throw new Error('UNITY_LICENSE_DECISION_EXPIRED');
      const configuredCapacity = this.licenses.reduce(
        (total, license) => total + license.concurrencyLimit,
        0,
      );
      if (configuredCapacity > this.decision.approvedCapacity)
        throw new Error('UNITY_LICENSE_CAPACITY_OVERCOMMITTED');
    }
  }

  async reserve(
    request: SandboxReservationRequest,
  ): Promise<SandboxReservation> {
    this.assertDecisionActive();
    const prior = [...this.reservations.values()].find(
      (reservation) =>
        reservation.request.idempotencyKey === request.idempotencyKey,
    );
    if (prior) return structuredClone(prior);
    const worker = this.findAvailableWorker(request);
    const license = this.findAvailableLicense();
    const available = Boolean(worker && license);
    const reservation: SandboxReservation & {
      request: SandboxReservationRequest;
    } = {
      reservationId: randomUUID(),
      status: available ? 'reserved' : 'waiting_for_license',
      runId: request.runId,
      request,
      ...(available
        ? {
            workerId: worker?.id,
            licenseId: license?.id,
          }
        : {}),
    };
    this.reservations.set(reservation.reservationId, reservation);
    return structuredClone(reservation);
  }

  async activate(reservationId: string): Promise<SandboxHandle> {
    this.assertDecisionActive();
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new Error('LICENSE_UNAVAILABLE');
    if (
      reservation.status !== 'reserved' ||
      !reservation.workerId ||
      !reservation.licenseId
    )
      throw new Error('LICENSE_UNAVAILABLE');
    if (this.activeReservationIds.has(reservationId))
      throw new Error('LEASE_ALREADY_ACTIVE');
    const worker = this.workers.find(
      (candidate) => candidate.id === reservation.workerId,
    );
    if (worker) worker.status = 'active';
    let activationRef: string | undefined;
    let containerId: string | undefined;
    try {
      if (this.licenseBroker) {
        activationRef = (
          await this.licenseBroker.activate(
            reservation.licenseId,
            reservation.runId,
          )
        ).activationRef;
      }
      if (this.containerRunner && reservation.request.container) {
        const container = await this.containerRunner.start({
          runId: reservation.runId,
          ...reservation.request.container,
          ...(reservation.request.maximumDurationSeconds
            ? {
                maximumDurationSeconds:
                  reservation.request.maximumDurationSeconds,
              }
            : {}),
        });
        containerId = container.containerId;
      }
    } catch (error) {
      if (activationRef && this.licenseBroker)
        await this.licenseBroker.return(activationRef).catch(() => undefined);
      if (worker) worker.status = 'ready';
      reservation.status = 'cancelled';
      throw error;
    }
    const handle = {
      handleId: randomUUID(),
      reservationId,
      runId: reservation.runId,
      workerId: reservation.workerId,
      licenseId: reservation.licenseId,
      status: 'active' as const,
      expiresAt: new Date(
        Date.now() +
          (reservation.request.maximumDurationSeconds ?? 1200) * 1000,
      ).toISOString(),
      ...(containerId ? { containerId } : {}),
      ...(activationRef ? { activationRef } : {}),
    };
    this.handles.set(handle.handleId, handle);
    this.activeReservationIds.add(reservationId);
    return structuredClone(handle);
  }

  async renew(handleId: string, ttlSeconds: number): Promise<void> {
    this.assertDecisionActive();
    const handle = this.handles.get(handleId);
    if (!handle || ttlSeconds <= 0) throw new Error('LEASE_NOT_FOUND');
    if (handle.expiresAt && Date.parse(handle.expiresAt) <= Date.now())
      throw new Error('LEASE_EXPIRED');
    handle.expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
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
    this.activeReservationIds.delete(handle.reservationId);
    let cleanupSucceeded = options.editorStopped ?? true;
    const cleanupErrors: Array<{ code: string; message: string }> = [];
    if (handle.containerId && this.containerRunner) {
      try {
        await this.containerRunner.cancel(handle.runId, 'lease_release');
      } catch (error) {
        cleanupSucceeded = false;
        await this.containerRunner
          .quarantine(handle.runId, 'lease_release_cleanup_failed')
          .catch(() => undefined);
        cleanupErrors.push({
          code: 'CONTAINER_CLEANUP_FAILED',
          message:
            error instanceof Error ? error.message : 'Container cleanup failed',
        });
      }
    }
    if (handle.activationRef && this.licenseBroker && cleanupSucceeded) {
      try {
        await this.licenseBroker.return(handle.activationRef);
      } catch (error) {
        cleanupSucceeded = false;
        cleanupErrors.push({
          code: 'LICENSE_RETURN_FAILED',
          message:
            error instanceof Error ? error.message : 'License return failed',
        });
      }
    }
    const stopped = cleanupSucceeded;
    const worker = this.workers.find(
      (candidate) => candidate.id === handle.workerId,
    );
    if (worker) worker.status = stopped ? 'ready' : 'quarantined';
    const license = this.licenses.find(
      (candidate) => candidate.id === handle.licenseId,
    );
    if (license && !stopped) license.status = 'quarantined';
    const reservation = this.reservations.get(handle.reservationId);
    if (reservation) reservation.status = 'cancelled';
    if (stopped) this.promoteWaiting();
    return stopped
      ? {
          status: 'released',
          editorStopped: true,
          childProcessesStopped: true,
          licenseReturned: true,
          workspaceSealed: true,
          evidenceFlushed: true,
          cleanupErrors,
        }
      : {
          status: 'quarantined',
          editorStopped: false,
          childProcessesStopped: false,
          licenseReturned: false,
          workspaceSealed: false,
          evidenceFlushed: false,
          cleanupErrors: [
            {
              code: 'EDITOR_STILL_RUNNING',
              message: 'Editor process did not reach quiescence',
            },
            ...cleanupErrors,
          ],
        };
  }

  async cancel(handleId: string, _reason: string): Promise<void> {
    await this.release(handleId);
  }

  async health(): Promise<{
    activeHandles: number;
    waitingReservations: number;
    quarantinedWorkers: number;
  }> {
    return {
      activeHandles: this.handles.size,
      waitingReservations: [...this.reservations.values()].filter(
        (reservation) => reservation.status === 'waiting_for_license',
      ).length,
      quarantinedWorkers: this.workers.filter(
        (worker) => worker.status === 'quarantined',
      ).length,
    };
  }

  async reconcile(): Promise<{ recovered: number; quarantined: number }> {
    this.promoteWaiting();
    return {
      recovered: 0,
      quarantined: this.workers.filter(
        (worker) => worker.status === 'quarantined',
      ).length,
    };
  }

  private promoteWaiting(): void {
    while (true) {
      const waiting = [...this.reservations.values()].find(
        (reservation) => reservation.status === 'waiting_for_license',
      );
      if (!waiting) return;
      const worker = this.findAvailableWorker(waiting.request);
      const license = this.findAvailableLicense();
      if (!worker || !license) return;
      waiting.status = 'reserved';
      waiting.workerId = worker.id;
      waiting.licenseId = license.id;
    }
  }

  private findAvailableWorker(
    request: SandboxReservationRequest,
  ):
    | (WorkerInput & { status: NonNullable<WorkerInput['status']> })
    | undefined {
    const reservedWorkerIds = new Set(
      [...this.reservations.values()]
        .filter((reservation) => reservation.status === 'reserved')
        .map((reservation) => reservation.workerId)
        .filter((id): id is string => Boolean(id)),
    );
    return this.workers.find(
      (worker) =>
        worker.status === 'ready' &&
        !reservedWorkerIds.has(worker.id) &&
        (!worker.editorVersion ||
          worker.editorVersion === request.editorVersion) &&
        (worker.capabilities === undefined ||
          request.capabilities.every((capability) =>
            worker.capabilities?.includes(capability),
          )),
    );
  }

  private findAvailableLicense():
    | (LicenseInput & { status: NonNullable<LicenseInput['status']> })
    | undefined {
    const reservedCounts = new Map<string, number>();
    for (const reservation of this.reservations.values()) {
      if (reservation.status === 'reserved' && reservation.licenseId) {
        reservedCounts.set(
          reservation.licenseId,
          (reservedCounts.get(reservation.licenseId) ?? 0) + 1,
        );
      }
    }
    return this.licenses.find((license) => {
      if (
        license.status !== 'active' ||
        (license.expiresAt !== undefined &&
          Date.parse(license.expiresAt) <= Date.now())
      )
        return false;
      return (reservedCounts.get(license.id) ?? 0) < license.concurrencyLimit;
    });
  }

  private assertDecisionActive(): void {
    if (!this.requireSignedDecision || !this.decision) return;
    if (Date.parse(this.decision.expiresAt) <= Date.now())
      throw new Error('UNITY_LICENSE_DECISION_EXPIRED');
  }
}

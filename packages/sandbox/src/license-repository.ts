import { randomUUID } from 'node:crypto';

export interface UnityWorkerRecord {
  id: string;
  status: 'ready' | 'active' | 'quarantined' | 'offline';
  editorVersion: string;
  capabilities: string[];
}

export interface EditorLicenseRecord {
  id: string;
  status: 'active' | 'expired' | 'quarantined';
  concurrencyLimit: number;
  expiresAt?: string;
}

export interface EditorLeaseRecord {
  id: string;
  runId: string;
  workerId: string;
  licenseId: string;
  status: 'reserved' | 'active' | 'released' | 'expired' | 'quarantined';
  acquiredAt: string;
  expiresAt: string;
  releasedAt?: string;
}

export class UnityWorkerRepository {
  constructor(private readonly workers: UnityWorkerRecord[] = []) {}
  list(): UnityWorkerRecord[] {
    return this.workers.map((worker) => structuredClone(worker));
  }
  getReady(version: string, capability: string): UnityWorkerRecord | undefined {
    return this.workers.find(
      (worker) =>
        worker.status === 'ready' &&
        worker.editorVersion === version &&
        worker.capabilities.includes(capability),
    );
  }
  setStatus(id: string, status: UnityWorkerRecord['status']): void {
    const worker = this.workers.find((candidate) => candidate.id === id);
    if (!worker) throw new Error('WORKER_NOT_FOUND');
    worker.status = status;
  }
}

export class EditorLicenseRepository {
  constructor(private readonly licenses: EditorLicenseRecord[] = []) {}
  list(): EditorLicenseRecord[] {
    return this.licenses.map((license) => structuredClone(license));
  }
  getActive(): EditorLicenseRecord | undefined {
    return this.licenses.find(
      (license) =>
        license.status === 'active' &&
        (!license.expiresAt || Date.parse(license.expiresAt) > Date.now()),
    );
  }
  setStatus(id: string, status: EditorLicenseRecord['status']): void {
    const license = this.licenses.find((candidate) => candidate.id === id);
    if (!license) throw new Error('LICENSE_NOT_FOUND');
    license.status = status;
  }
}

export class EditorLeaseRepository {
  constructor(private readonly leases: EditorLeaseRecord[] = []) {}

  create(input: Omit<EditorLeaseRecord, 'id'>): EditorLeaseRecord {
    const existing = this.leases.find(
      (lease) =>
        lease.runId === input.runId &&
        !['released', 'expired'].includes(lease.status),
    );
    if (existing) throw new Error('LEASE_ALREADY_EXISTS');
    const lease = { ...input, id: randomUUID() };
    this.leases.push(lease);
    return structuredClone(lease);
  }

  get(id: string): EditorLeaseRecord {
    const lease = this.leases.find((candidate) => candidate.id === id);
    if (!lease) throw new Error('LEASE_NOT_FOUND');
    return structuredClone(lease);
  }

  list(runId?: string): EditorLeaseRecord[] {
    return this.leases
      .filter((lease) => !runId || lease.runId === runId)
      .map((lease) => structuredClone(lease));
  }

  setStatus(
    id: string,
    status: EditorLeaseRecord['status'],
    releasedAt = status === 'released' ? new Date().toISOString() : undefined,
  ): EditorLeaseRecord {
    const lease = this.leases.find((candidate) => candidate.id === id);
    if (!lease) throw new Error('LEASE_NOT_FOUND');
    lease.status = status;
    if (releasedAt) lease.releasedAt = releasedAt;
    return structuredClone(lease);
  }
}

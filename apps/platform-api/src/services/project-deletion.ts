export interface DeletionAuditEvent {
  projectId: string;
  action:
    | 'freeze'
    | 'revoke_preview'
    | 'delete_objects'
    | 'delete_repository'
    | 'tombstone';
  occurredAt: string;
}

export class ProjectDeletionService {
  private readonly frozen = new Set<string>();
  private readonly revokedPreviews = new Set<string>();
  private readonly audit: DeletionAuditEvent[] = [];

  requestDeletion(projectId: string): DeletionAuditEvent[] {
    if (this.frozen.has(projectId)) return this.events(projectId);
    this.frozen.add(projectId);
    for (const action of [
      'freeze',
      'revoke_preview',
      'delete_objects',
      'delete_repository',
      'tombstone',
    ] as const)
      this.audit.push({
        projectId,
        action,
        occurredAt: new Date().toISOString(),
      });
    this.revokedPreviews.add(projectId);
    return this.events(projectId);
  }

  isFrozen(projectId: string): boolean {
    return this.frozen.has(projectId);
  }
  isPreviewRevoked(projectId: string): boolean {
    return this.revokedPreviews.has(projectId);
  }
  events(projectId: string): DeletionAuditEvent[] {
    return this.audit
      .filter((event) => event.projectId === projectId)
      .map((event) => structuredClone(event));
  }
}

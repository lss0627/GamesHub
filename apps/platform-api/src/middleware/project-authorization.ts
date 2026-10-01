import type { RequestIdentity } from './auth';

export class ProjectAuthorizationError extends Error {
  readonly code = 'PROJECT_FORBIDDEN';
  constructor(message = 'The identity is not allowed to access this project') {
    super(message);
  }
}

export function assertProjectAccess(
  identity: Pick<RequestIdentity, 'userId' | 'role'>,
  ownerId: string,
  action: 'read' | 'write' | 'operate' = 'read',
): void {
  if (identity.role === 'admin' || identity.role === 'operator') return;
  if (identity.role === 'developer' && action !== 'write') return;
  if (identity.userId !== ownerId) throw new ProjectAuthorizationError();
}

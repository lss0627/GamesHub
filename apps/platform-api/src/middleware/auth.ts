export interface RequestIdentity {
  userId: string;
  role: 'creator' | 'developer' | 'operator' | 'admin';
  token: string;
}
export class AuthenticationError extends Error {
  readonly code = 'AUTH_REQUIRED';
}
export function parseBearerToken(header: string | undefined): string {
  const match = header?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match?.[1]) throw new AuthenticationError('A bearer token is required');
  return match[1];
}
export function createRequestIdentity(
  header: string | undefined,
  verify: (token: string) => Omit<RequestIdentity, 'token'>,
): RequestIdentity {
  const token = parseBearerToken(header);
  return { ...verify(token), token: '[REDACTED]' };
}
export function authMiddleware(
  verify: (token: string) => Omit<RequestIdentity, 'token'>,
) {
  return async (
    request: { headers: { authorization?: string } },
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  ) => {
    try {
      (request as unknown as { identity: RequestIdentity }).identity =
        createRequestIdentity(request.headers.authorization, verify);
    } catch (error) {
      return reply.code(401).send({
        code: 'AUTH_REQUIRED',
        detail: error instanceof Error ? error.message : 'Unauthorized',
      });
    }
  };
}

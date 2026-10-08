import { createHmac, timingSafeEqual } from 'node:crypto';

export class AuthError extends Error {
  readonly status = 401;
  constructor(message = 'Please sign in.') {
    super(message);
    this.name = 'AuthError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const decode = (part: string): unknown =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * Checks a Supabase access token (an HS256 JWT signed with the project's JWT secret)
 * and returns the user's id. Throws `AuthError` for anything that is not a valid,
 * unexpired token of a signed-in user.
 *
 * Projects that sign with asymmetric keys instead need this replaced by a JWKS check.
 */
export function verifyAccessToken(
  token: string | undefined,
  secret: string,
  nowMs = Date.now(),
): string {
  const parts = (token ?? '').split('.');
  if (parts.length !== 3) throw new AuthError();
  const [header, payload, signature] = parts as [string, string, string];

  let claims: { sub?: unknown; exp?: unknown; role?: unknown };
  try {
    // Only HS256: never trust the algorithm a token asks for.
    if ((decode(header) as { alg?: unknown }).alg !== 'HS256') throw new AuthError();
    claims = decode(payload) as typeof claims;
  } catch {
    throw new AuthError();
  }

  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new AuthError();

  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= nowMs) {
    throw new AuthError('Your session has expired. Please sign in again.');
  }
  if (claims.role !== 'authenticated' || typeof claims.sub !== 'string' || !UUID.test(claims.sub)) {
    throw new AuthError();
  }
  return claims.sub;
}

/** Makes an access token the way Supabase would. For tests and local development only. */
export function signAccessToken(userId: string, secret: string, expiresAtMs: number): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: userId,
    role: 'authenticated',
    exp: Math.floor(expiresAtMs / 1000),
  })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

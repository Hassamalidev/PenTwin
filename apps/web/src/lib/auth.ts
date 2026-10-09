/**
 * Sign-in, through Supabase Auth's HTTP interface.
 *
 * WRITTEN FROM SUPABASE'S DOCUMENTATION AND NEVER RUN AGAINST A REAL PROJECT: there is no
 * Supabase account yet. The browser tests use a stand-in that answers the way the
 * documentation says the service does. Expect to adjust details the first time it meets
 * the real thing.
 *
 * No Supabase library is used: these are six plain requests, and the worker checks the
 * resulting token itself.
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const KEY = 'pentwin.session.v1';
const PENDING_CONSENT = 'pentwin.pending-consent.v1';

/** Whether this build knows where to sign people in. Without it there are no accounts. */
export const authConfigured = SUPABASE_URL !== '' && ANON_KEY !== '';

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** When the access token stops working, in milliseconds. */
  expiresAt: number;
  userId: string;
  email: string;
}

/** Something the person signing in can act on. */
export class AuthProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthProblem';
  }
}

interface TokenAnswer {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
}

const readStored = (): Session | undefined => {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Session | null;
    return stored && typeof stored.accessToken === 'string' ? stored : undefined;
  } catch {
    return undefined;
  }
};

const store = (answer: TokenAnswer, fallbackEmail = ''): Session => {
  if (!answer.access_token || !answer.refresh_token) {
    throw new AuthProblem('Signing in did not work. Please try again.');
  }
  // The token itself says who it belongs to; the worker checks its signature.
  let claims: { sub?: string; email?: string } = {};
  try {
    const payload = answer.access_token.split('.')[1] ?? '';
    claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as typeof claims;
  } catch {
    // An unreadable token still works as a token.
  }
  const session: Session = {
    accessToken: answer.access_token,
    refreshToken: answer.refresh_token,
    expiresAt: Date.now() + (answer.expires_in ?? 3600) * 1000,
    userId: answer.user?.id ?? claims.sub ?? '',
    email: answer.user?.email ?? claims.email ?? fallbackEmail,
  };
  localStorage.setItem(KEY, JSON.stringify(session));
  return session;
};

/** Plain words for the reasons Supabase gives. Its own wording is never shown. */
const explain = (status: number, body: Record<string, unknown>): string => {
  const reason = `${String(body.error_code ?? '')} ${String(body.msg ?? body.error_description ?? body.message ?? '')}`;
  if (/invalid_credentials|Invalid login/i.test(reason)) {
    return 'That email and password do not match. Please check them and try again.';
  }
  if (/email_not_confirmed|not confirmed/i.test(reason)) {
    return 'Please open the link in the email we sent you first, then sign in.';
  }
  if (/user_already_exists|already registered/i.test(reason)) {
    return 'There is already an account with this email. Sign in instead, or reset the password.';
  }
  if (/weak_password|at least/i.test(reason)) {
    return 'Please choose a longer password: at least 8 characters.';
  }
  if (status === 429 || /rate limit/i.test(reason)) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  return 'That did not work. Please try again in a moment.';
};

const request = async (
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<Record<string, unknown>> => {
  if (!authConfigured) throw new AuthProblem('Accounts are not switched on yet.');
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
      method: init.method ?? 'POST',
      headers: {
        apikey: ANON_KEY,
        'content-type': 'application/json',
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new AuthProblem('The sign-in service could not be reached. Please try again.');
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new AuthProblem(explain(response.status, body));
  return body;
};

/** Where the links in our emails, and Google, send people back to. */
const returnAddress = (): string => `${window.location.origin}/signin`;

/**
 * Creates an account. Returns the session if the project signs people in straight away,
 * or `undefined` when they must first open the link in a confirmation email.
 */
export async function signUp(email: string, password: string): Promise<Session | undefined> {
  const answer = (await request(`/signup?redirect_to=${encodeURIComponent(returnAddress())}`, {
    body: { email, password },
  })) as TokenAnswer;
  return answer.access_token ? store(answer, email) : undefined;
}

export async function signIn(email: string, password: string): Promise<Session> {
  return store(
    (await request('/token?grant_type=password', { body: { email, password } })) as TokenAnswer,
    email,
  );
}

/** Sends the "reset your password" email. Says nothing about whether the address exists. */
export async function requestPasswordReset(email: string): Promise<void> {
  await request(`/recover?redirect_to=${encodeURIComponent(returnAddress())}`, {
    body: { email },
  });
}

/** Sets a new password for whoever is signed in (after following a reset link). */
export async function setPassword(password: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) throw new AuthProblem('This link has expired. Please ask for a new one.');
  await request('/user', { method: 'PUT', body: { password }, token });
}

/**
 * Whether to offer "Continue with Google". It only works once Google is set up as a
 * provider in the Supabase project, so the button stays hidden until this is switched on.
 */
export const googleConfigured = authConfigured && process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN === 'on';

/** The address that starts "Continue with Google". */
export const googleSignInUrl = (): string =>
  `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(returnAddress())}`;

/**
 * Picks up a session handed back in the page address after an email link or Google.
 * Returns what kind of link it was, and removes the tokens from the address bar.
 */
export function takeSessionFromAddress(): { session?: Session; kind?: string; error?: string } {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (!fragment.has('access_token') && !fragment.has('error_description')) return {};
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  if (fragment.has('error_description')) {
    return { error: 'That link did not work or has expired. Please ask for a new one.' };
  }
  const session = store({
    access_token: fragment.get('access_token') ?? undefined,
    refresh_token: fragment.get('refresh_token') ?? undefined,
    expires_in: Number(fragment.get('expires_in') ?? 3600),
  });
  return { session, kind: fragment.get('type') ?? undefined };
}

export const currentSession = (): Session | undefined =>
  typeof localStorage === 'undefined' ? undefined : readStored();

let refreshing: Promise<Session | undefined> | undefined;

/**
 * A token the worker will accept, renewing it shortly before it runs out. Returns
 * `undefined` when nobody is signed in or the session could not be renewed.
 */
export async function getAccessToken(): Promise<string | undefined> {
  const session = currentSession();
  if (!session) return undefined;
  if (session.expiresAt - Date.now() > 60_000) return session.accessToken;
  refreshing ??= (async () => {
    try {
      return store(
        (await request('/token?grant_type=refresh_token', {
          body: { refresh_token: session.refreshToken },
        })) as TokenAnswer,
        session.email,
      );
    } catch {
      localStorage.removeItem(KEY);
      return undefined;
    } finally {
      refreshing = undefined;
    }
  })();
  return (await refreshing)?.accessToken;
}

export async function signOut(): Promise<void> {
  const session = currentSession();
  localStorage.removeItem(KEY);
  // Best effort: the local sign-out has already happened.
  if (session) await request('/logout', { token: session.accessToken }).catch(() => undefined);
}

/** Remembers that the person ticked the box at sign-up, until it can be recorded. */
export const rememberConsent = (version: string): void =>
  localStorage.setItem(PENDING_CONSENT, version);
export const pendingConsent = (): string | null => localStorage.getItem(PENDING_CONSENT);
export const clearPendingConsent = (): void => localStorage.removeItem(PENDING_CONSENT);

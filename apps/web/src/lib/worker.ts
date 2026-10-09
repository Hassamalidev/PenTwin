import { getAccessToken } from './auth';

export const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'http://localhost:8787';

/** The worker said no, in words the user can act on. `status` 0 means it was unreachable. */
export class WorkerProblem extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'WorkerProblem';
  }
}

export interface WorkerCall {
  method?: string;
  body?: unknown;
  /** Send the signed-in user's token. Fails with `signed_out` if nobody is signed in. */
  auth?: boolean;
  /** How many times to try again when the worker says it is busy. */
  retries?: number;
  /** Called each time the worker is busy and the call is about to wait and retry. */
  onWaiting?: (attempt: number) => void;
}

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * Calls the worker. When the worker answers "busy" (503) it waits as long as asked and
 * tries again by itself, so one crowded moment does not become an error on screen.
 * Nothing is charged for a request that was turned away.
 */
export async function callWorker<T>(path: string, call: WorkerCall = {}): Promise<T> {
  const { method = 'GET', body, auth = false, retries = 8, onWaiting } = call;
  for (let attempt = 1; ; attempt++) {
    const token = auth ? await getAccessToken() : undefined;
    if (auth && !token) throw new WorkerProblem('Please sign in.', 401, 'signed_out');

    let response: Response;
    try {
      response = await fetch(`${WORKER_URL}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new WorkerProblem(
        'The service could not be reached. Nothing was charged. Please try again.',
        0,
      );
    }

    if (response.status === 503 && attempt <= retries && response.headers.has('retry-after')) {
      onWaiting?.(attempt);
      const seconds = Math.min(10, Math.max(0.2, Number(response.headers.get('retry-after')) || 5));
      // A little apart from everyone else who was told the same thing.
      await wait(seconds * 1000 * (0.7 + Math.random() * 0.6));
      continue;
    }

    const answer = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    if (!response.ok) {
      throw new WorkerProblem(
        answer.error ?? 'Something went wrong. Nothing was charged. Please try again.',
        response.status,
        answer.code,
      );
    }
    return answer as T;
  }
}

/** Which mode the worker is in. An unreachable worker counts as the open local demo. */
export const workerHasAccounts = async (): Promise<boolean> =>
  callWorker<{ accounts?: boolean }>('/info').then(
    (info) => info.accounts === true,
    () => false,
  );

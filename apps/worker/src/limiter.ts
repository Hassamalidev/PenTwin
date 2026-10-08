/** Thrown when too much work is already waiting. The caller should ask again shortly. */
export class BusyError extends Error {
  constructor() {
    super('The export queue is full.');
    this.name = 'BusyError';
  }
}

export interface Limiter {
  /** Runs `task` when a slot is free. Rejects with BusyError if the queue is full. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** How many tasks are running and how many are waiting. */
  readonly load: { running: number; waiting: number };
  /** Resolves once nothing is running or waiting. */
  idle(): Promise<void>;
}

/**
 * Lets at most `concurrent` tasks run at once and at most `waiting` more wait their turn.
 * Each export holds whole pages in memory, so this is what keeps the worker inside its
 * memory limit when many arrive together: the rest wait, and beyond that are turned away
 * quickly instead of piling up.
 */
export function createLimiter(concurrent: number, waiting: number): Limiter {
  let running = 0;
  const queue: (() => void)[] = [];
  let whenIdle: (() => void)[] = [];

  const release = (): void => {
    const next = queue.shift();
    if (next) {
      next();
      return;
    }
    running--;
    if (running === 0) {
      whenIdle.forEach((resolve) => resolve());
      whenIdle = [];
    }
  };

  return {
    async run(task) {
      if (running >= concurrent) {
        if (queue.length >= waiting) throw new BusyError();
        // The slot is handed over directly, so `running` stays the same.
        await new Promise<void>((resolve) => queue.push(resolve));
      } else {
        running++;
      }
      try {
        return await task();
      } finally {
        release();
      }
    },
    get load() {
      return { running, waiting: queue.length };
    },
    idle: () =>
      running === 0 ? Promise.resolve() : new Promise((resolve) => whenIdle.push(resolve)),
  };
}

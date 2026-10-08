import { describe, expect, it } from 'vitest';
import { BusyError, createLimiter } from './limiter';

/** A task that finishes when told to. */
const gate = () => {
  let open!: () => void;
  const done = new Promise<void>((resolve) => (open = resolve));
  return { open, task: () => done };
};
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the export limiter', () => {
  it('never runs more than the allowed number at once', async () => {
    const limiter = createLimiter(2, 10);
    let running = 0;
    let most = 0;
    const work = async (): Promise<void> => {
      running++;
      most = Math.max(most, running);
      await tick();
      running--;
    };
    await Promise.all(Array.from({ length: 9 }, () => limiter.run(work)));
    expect(most).toBe(2);
    expect(limiter.load).toEqual({ running: 0, waiting: 0 });
  });

  it('runs waiting tasks in the order they arrived', async () => {
    const limiter = createLimiter(1, 10);
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        limiter.run(async () => {
          await tick();
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('turns work away at once when the queue is full', async () => {
    const limiter = createLimiter(1, 1);
    const first = gate();
    const running = limiter.run(first.task);
    const waiting = limiter.run(() => Promise.resolve('waited'));
    await expect(limiter.run(() => Promise.resolve('never'))).rejects.toBeInstanceOf(BusyError);
    expect(limiter.load).toEqual({ running: 1, waiting: 1 });

    first.open();
    await running;
    await expect(waiting).resolves.toBe('waited');
    // Room again once the queue has drained.
    await expect(limiter.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('frees the slot when a task fails', async () => {
    const limiter = createLimiter(1, 0);
    await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limiter.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('says when everything has finished', async () => {
    const limiter = createLimiter(1, 5);
    await limiter.idle();
    const first = gate();
    const all = [limiter.run(first.task), limiter.run(tick)];
    let idle = false;
    void limiter.idle().then(() => (idle = true));
    await tick();
    expect(idle).toBe(false);
    first.open();
    await Promise.all(all);
    await tick();
    expect(idle).toBe(true);
  });
});

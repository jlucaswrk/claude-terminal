import { describe, test, expect, beforeEach } from 'bun:test';
import { Semaphore } from '../semaphore';

describe('Semaphore', () => {
  describe('constructor', () => {
    test('initializes with correct permits', () => {
      const sem = new Semaphore(3);
      expect(sem.availablePermits()).toBe(3);
    });

    test('allows 0 permits for unbounded mode', () => {
      const sem = new Semaphore(0);
      expect(sem.isUnbounded()).toBe(true);
      expect(sem.availablePermits()).toBe(Infinity);
      expect(sem.getMaxPermits()).toBe(0);
    });

    test('throws if permits < 0', () => {
      expect(() => new Semaphore(-1)).toThrow('Semaphore permits cannot be negative');
    });
  });

  describe('acquire', () => {
    test('decrements permits when available', async () => {
      const sem = new Semaphore(3);
      await sem.acquire();
      expect(sem.availablePermits()).toBe(2);
    });

    test('allows multiple acquires until exhausted', async () => {
      const sem = new Semaphore(2);
      await sem.acquire();
      await sem.acquire();
      expect(sem.availablePermits()).toBe(0);
    });

    test('blocks when no permits available', async () => {
      const sem = new Semaphore(1);
      await sem.acquire();

      let resolved = false;
      const promise = sem.acquire().then(() => {
        resolved = true;
      });

      // Give promise a chance to resolve (it shouldn't)
      await new Promise((r) => setTimeout(r, 10));
      expect(resolved).toBe(false);

      // Release should unblock
      sem.release();
      await promise;
      expect(resolved).toBe(true);
    });
  });

  describe('release', () => {
    test('increments permits when none waiting', () => {
      const sem = new Semaphore(2);
      sem.release(); // Shouldn't go above max
      expect(sem.availablePermits()).toBe(2);
    });

    test('resolves waiting acquire in FIFO order', async () => {
      const sem = new Semaphore(1);
      await sem.acquire();

      const order: number[] = [];

      const p1 = sem.acquire().then(() => order.push(1));
      const p2 = sem.acquire().then(() => order.push(2));
      const p3 = sem.acquire().then(() => order.push(3));

      // Let promises register
      await new Promise((r) => setTimeout(r, 5));

      expect(sem.waitingCount()).toBe(3);

      sem.release();
      await p1;
      sem.release();
      await p2;
      sem.release();
      await p3;

      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('availablePermits', () => {
    test('returns correct count after operations', async () => {
      const sem = new Semaphore(3);
      expect(sem.availablePermits()).toBe(3);

      await sem.acquire();
      expect(sem.availablePermits()).toBe(2);

      await sem.acquire();
      expect(sem.availablePermits()).toBe(1);

      sem.release();
      expect(sem.availablePermits()).toBe(2);
    });
  });

  describe('waitingCount', () => {
    test('tracks waiting callers', async () => {
      const sem = new Semaphore(1);
      await sem.acquire();
      expect(sem.waitingCount()).toBe(0);

      sem.acquire(); // Will block
      await new Promise((r) => setTimeout(r, 5));
      expect(sem.waitingCount()).toBe(1);

      sem.acquire(); // Will also block
      await new Promise((r) => setTimeout(r, 5));
      expect(sem.waitingCount()).toBe(2);

      sem.release();
      await new Promise((r) => setTimeout(r, 5));
      expect(sem.waitingCount()).toBe(1);
    });
  });

  describe('unbounded mode', () => {
    test('acquire does not block in unbounded mode', async () => {
      const sem = new Semaphore(0);

      // Should not block even with many concurrent acquires
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(sem.acquire());
      }

      // All should resolve immediately
      await Promise.all(promises);
      expect(sem.waitingCount()).toBe(0);
    });

    test('release is no-op in unbounded mode', () => {
      const sem = new Semaphore(0);
      // Should not throw
      sem.release();
      sem.release();
      expect(sem.availablePermits()).toBe(Infinity);
    });

    test('switching to unbounded releases all waiting', async () => {
      const sem = new Semaphore(1);
      await sem.acquire();

      const resolved: number[] = [];
      sem.acquire().then(() => resolved.push(1));
      sem.acquire().then(() => resolved.push(2));

      await new Promise((r) => setTimeout(r, 5));
      expect(sem.waitingCount()).toBe(2);

      // Switch to unbounded - should release all waiting
      sem.setMaxPermits(0);
      await new Promise((r) => setTimeout(r, 5));

      expect(sem.waitingCount()).toBe(0);
      expect(resolved).toContain(1);
      expect(resolved).toContain(2);
      expect(sem.isUnbounded()).toBe(true);
    });

    test('switching from unbounded to bounded', async () => {
      const sem = new Semaphore(0);
      expect(sem.isUnbounded()).toBe(true);

      sem.setMaxPermits(2);
      expect(sem.isUnbounded()).toBe(false);
      expect(sem.availablePermits()).toBe(2);
      expect(sem.getMaxPermits()).toBe(2);
    });
  });

  describe('setMaxPermits', () => {
    test('throws if newMax < 0', () => {
      const sem = new Semaphore(3);
      expect(() => sem.setMaxPermits(-1)).toThrow('Semaphore permits cannot be negative');
    });

    test('allows setting to 0 for unbounded mode', () => {
      const sem = new Semaphore(3);
      sem.setMaxPermits(0);
      expect(sem.isUnbounded()).toBe(true);
      expect(sem.availablePermits()).toBe(Infinity);
    });

    test('increases permits correctly', async () => {
      const sem = new Semaphore(2);
      await sem.acquire();
      await sem.acquire();
      expect(sem.availablePermits()).toBe(0);

      sem.setMaxPermits(4);
      expect(sem.availablePermits()).toBe(2);
      expect(sem.getMaxPermits()).toBe(4);
    });

    test('resolves waiting when increasing', async () => {
      const sem = new Semaphore(1);
      await sem.acquire();

      let resolved = false;
      const promise = sem.acquire().then(() => {
        resolved = true;
      });

      await new Promise((r) => setTimeout(r, 5));
      expect(resolved).toBe(false);

      sem.setMaxPermits(2);
      await promise;
      expect(resolved).toBe(true);
    });

    test('decreases permits correctly', async () => {
      const sem = new Semaphore(3);
      expect(sem.availablePermits()).toBe(3);

      sem.setMaxPermits(1);
      expect(sem.availablePermits()).toBe(1);
      expect(sem.getMaxPermits()).toBe(1);
    });
  });

  describe('concurrency control', () => {
    test('limits concurrent operations', async () => {
      const sem = new Semaphore(2);
      let concurrent = 0;
      let maxConcurrent = 0;

      const task = async (id: number) => {
        await sem.acquire();
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 20));
        concurrent--;
        sem.release();
        return id;
      };

      const results = await Promise.all([
        task(1),
        task(2),
        task(3),
        task(4),
        task(5),
      ]);

      expect(maxConcurrent).toBe(2);
      expect(results).toEqual([1, 2, 3, 4, 5]);
    });
  });
});

/**
 * Semaphore implementation for concurrency control
 *
 * Controls the number of permits available for parallel execution.
 * When permits = 0, new acquisitions block until a permit is released.
 * Releases are processed in FIFO order.
 */
export class Semaphore {
  private permits: number;
  private readonly maxPermits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    if (permits < 1) {
      throw new Error('Semaphore requires at least 1 permit');
    }
    this.permits = permits;
    this.maxPermits = permits;
  }

  /**
   * Acquire a permit. If no permits are available, waits until one is released.
   * Promises are resolved in FIFO order.
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    // No permits available, add to waiting queue
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  /**
   * Release a permit. If there are waiting acquisitions, the first one (FIFO) is resolved.
   */
  release(): void {
    if (this.waiting.length > 0) {
      // FIFO: resolve the first waiting promise
      const next = this.waiting.shift()!;
      next();
    } else {
      // No one waiting, increment permits (but don't exceed max)
      if (this.permits < this.maxPermits) {
        this.permits++;
      }
    }
  }

  /**
   * Get the number of permits currently available
   */
  availablePermits(): number {
    return this.permits;
  }

  /**
   * Get the number of callers waiting for a permit
   */
  waitingCount(): number {
    return this.waiting.length;
  }

  /**
   * Update the maximum number of permits (for runtime configuration)
   */
  setMaxPermits(newMax: number): void {
    if (newMax < 1) {
      throw new Error('Semaphore requires at least 1 permit');
    }

    const diff = newMax - this.maxPermits;

    if (diff > 0) {
      // Increasing permits - release any that can be satisfied immediately
      for (let i = 0; i < diff && this.waiting.length > 0; i++) {
        const next = this.waiting.shift()!;
        next();
      }
      // Any remaining increases go to available permits
      this.permits = Math.min(this.permits + diff, newMax);
    } else if (diff < 0) {
      // Decreasing permits - adjust available permits but don't interrupt running tasks
      this.permits = Math.max(0, this.permits + diff);
    }

    (this as { maxPermits: number }).maxPermits = newMax;
  }

  /**
   * Get the maximum number of permits
   */
  getMaxPermits(): number {
    return this.maxPermits;
  }
}

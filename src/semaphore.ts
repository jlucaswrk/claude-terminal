/**
 * Semaphore implementation for concurrency control
 *
 * Controls the number of permits available for parallel execution.
 * When permits = 0 (during bounded mode), new acquisitions block until a permit is released.
 * Releases are processed in FIFO order.
 *
 * Special: maxPermits = 0 means unbounded mode (no limit on concurrent executions).
 */
export class Semaphore {
  private permits: number;
  private readonly maxPermits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    if (permits < 0) {
      throw new Error('Semaphore permits cannot be negative');
    }
    // 0 permits means unbounded mode
    this.permits = permits;
    this.maxPermits = permits;
  }

  /**
   * Check if this semaphore is in unbounded mode (no concurrency limit)
   */
  isUnbounded(): boolean {
    return this.maxPermits === 0;
  }

  /**
   * Acquire a permit. If no permits are available, waits until one is released.
   * In unbounded mode (maxPermits = 0), returns immediately without blocking.
   * Promises are resolved in FIFO order.
   */
  async acquire(): Promise<void> {
    // Unbounded mode: no limit, always allow
    if (this.isUnbounded()) {
      return;
    }

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
   * In unbounded mode, this is a no-op.
   */
  release(): void {
    // Unbounded mode: no-op
    if (this.isUnbounded()) {
      return;
    }

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
   * Get the number of permits currently available.
   * Returns Infinity for unbounded mode.
   */
  availablePermits(): number {
    if (this.isUnbounded()) {
      return Infinity;
    }
    return this.permits;
  }

  /**
   * Get the number of callers waiting for a permit
   */
  waitingCount(): number {
    return this.waiting.length;
  }

  /**
   * Update the maximum number of permits (for runtime configuration).
   * Set to 0 for unbounded mode (no limit).
   */
  setMaxPermits(newMax: number): void {
    if (newMax < 0) {
      throw new Error('Semaphore permits cannot be negative');
    }

    // Switching to unbounded mode
    if (newMax === 0) {
      // Release all waiting acquires
      while (this.waiting.length > 0) {
        const next = this.waiting.shift()!;
        next();
      }
      this.permits = 0;
      (this as { maxPermits: number }).maxPermits = 0;
      return;
    }

    // Switching from unbounded to bounded
    if (this.isUnbounded()) {
      this.permits = newMax;
      (this as { maxPermits: number }).maxPermits = newMax;
      return;
    }

    // Normal bounded adjustment
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
   * Get the maximum number of permits.
   * Returns 0 for unbounded mode.
   */
  getMaxPermits(): number {
    return this.maxPermits;
  }
}

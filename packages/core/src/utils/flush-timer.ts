import { safeSetTimeout } from './index'

/**
 * The pending flush timer of an export queue, and when it is due.
 *
 * The queues arm this from two kinds of place: one that must not push a pending
 * flush further out (every capture reaches it), and one that must not pull a
 * flush back in front of a wait the endpoint asked for. Holding the deadline
 * next to the handle is what lets the second kind compare against the first.
 *
 * Deliberately outside the `utils` barrel, like `RetryAfterWindow`: that barrel
 * is re-exported wholesale from the package entry point, and this is internal.
 */
export class FlushTimer {
  private _timer?: ReturnType<typeof safeSetTimeout>
  private _firesAt = 0

  /** @param _onFire runs when the timer elapses, after the handle is released. */
  constructor(private readonly _onFire: () => void) {}

  /** Whether a flush is already scheduled. */
  get pending(): boolean {
    return !!this._timer
  }

  /** Schedules a flush in `delayMs`, replacing any timer already pending. */
  arm(delayMs: number): void {
    this.clear()
    this._firesAt = Date.now() + delayMs
    this._timer = safeSetTimeout(() => {
      this._timer = undefined
      this._onFire()
    }, delayMs)
  }

  /**
   * Arms only if it moves the flush later, so a timer armed for a longer wait
   * survives a caller asking for a shorter one.
   */
  armNoEarlierThan(delayMs: number): void {
    if (this._timer && Date.now() + delayMs <= this._firesAt) {
      return
    }
    this.arm(delayMs)
  }

  clear(): void {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = undefined
    }
  }
}

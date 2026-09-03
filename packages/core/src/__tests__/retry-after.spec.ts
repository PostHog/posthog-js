import { MAX_RETRY_AFTER_MS, parseRetryAfterMs, RetryAfterWindow } from '../utils/retry-after'

describe('parseRetryAfterMs', () => {
  const now = Date.parse('2026-09-01T12:00:00Z')

  it('reads delta-seconds', () => {
    expect(parseRetryAfterMs('60', now)).toBe(60_000)
    expect(parseRetryAfterMs('  7  ', now)).toBe(7_000)
  })

  it('reads an HTTP-date as a delay from now', () => {
    expect(parseRetryAfterMs('Tue, 01 Sep 2026 12:00:30 GMT', now)).toBe(30_000)
  })

  it('reads the outermost hop when two proxies each append one', () => {
    // `headers.get` joins repeated headers with ", ". The date form carries a
    // comma of its own, so only the delta-seconds form is split.
    expect(parseRetryAfterMs('60, 120', now)).toBe(60_000)
    expect(parseRetryAfterMs('60,120', now)).toBe(60_000)
    expect(parseRetryAfterMs('Tue, 01 Sep 2026 12:00:30 GMT', now)).toBe(30_000)
  })

  it('ignores a header that does not name a future time', () => {
    // A past date and a zero delta both mean "retry now", which is the caller's own backoff.
    expect(parseRetryAfterMs('Tue, 01 Sep 2026 11:59:00 GMT', now)).toBeUndefined()
    expect(parseRetryAfterMs('0', now)).toBeUndefined()
  })

  it('ignores numeric junk rather than letting Date.parse read it as a year', () => {
    // `Date.parse` reads all three as dates in 2001, so a device clock earlier
    // than that would otherwise turn them into a real wait.
    for (const clock of [now, Date.parse('1999-01-01T00:00:00Z')]) {
      expect(parseRetryAfterMs('-5', clock)).toBeUndefined()
      expect(parseRetryAfterMs('+5', clock)).toBeUndefined()
      expect(parseRetryAfterMs('5.5', clock)).toBeUndefined()
    }
  })

  it('ignores a header it cannot parse rather than guessing', () => {
    // "10 minutes" must not read as 10 seconds.
    expect(parseRetryAfterMs('10 minutes', now)).toBeUndefined()
    expect(parseRetryAfterMs('soon', now)).toBeUndefined()
    expect(parseRetryAfterMs('', now)).toBeUndefined()
    expect(parseRetryAfterMs(null, now)).toBeUndefined()
    expect(parseRetryAfterMs(undefined, now)).toBeUndefined()
  })

  it('caps an unbounded value so a bogus header cannot strand a queue', () => {
    expect(parseRetryAfterMs('86400', now)).toBe(5 * 60_000)
  })

  it('ignores a value that is not a string', () => {
    // The header comes from injected transport code, so `headers.get` can hand
    // back anything at all.
    expect(parseRetryAfterMs(60, now)).toBeUndefined()
    expect(parseRetryAfterMs(['60'], now)).toBeUndefined()
    expect(parseRetryAfterMs({}, now)).toBeUndefined()
  })
})

describe('RetryAfterWindow', () => {
  const open = (retryAfterMs: number): RetryAfterWindow => {
    const window = new RetryAfterWindow()
    window.record({ kind: 'retry-later', retryAfterMs })
    return window
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-09-01T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts down to the deadline the endpoint named', () => {
    const window = open(60_000)
    expect(window.remainingMs()).toBe(60_000)

    vi.setSystemTime(Date.now() + 20_000)
    expect(window.remainingMs()).toBe(40_000)
    expect(window.isOpen()).toBe(true)
  })

  it('does not bring back a window that already ran out', () => {
    // The deadline is wall clock, so a backward step after the wait was served
    // would otherwise make the queue wait it out a second time.
    const window = open(60_000)
    const installedAt = Date.now()

    vi.setSystemTime(installedAt + 600_000)
    expect(window.remainingMs()).toBe(0)

    vi.setSystemTime(installedAt + 30_000)
    expect(window.remainingMs()).toBe(0)
    expect(window.isOpen()).toBe(false)
  })

  it('survives a clock correction of a few milliseconds', () => {
    // NTP nudges the clock backwards by milliseconds routinely; discarding a
    // five-minute wait over one would send straight back into the rate limit.
    const window = open(300_000)

    vi.setSystemTime(Date.now() - 1)
    expect(window.isOpen()).toBe(true)
  })

  it('discards the window on a real backward clock step', () => {
    const window = open(300_000)

    vi.setSystemTime(Date.now() - 3_600_000)
    expect(window.remainingMs()).toBe(0)
  })

  it('does not extend an open window on a repeated refusal', () => {
    const window = open(60_000)
    vi.setSystemTime(Date.now() + 20_000)

    window.record({ kind: 'retry-later', retryAfterMs: 60_000 })
    expect(window.remainingMs()).toBe(40_000)
  })

  it('keeps the window when a batch is refused for size', () => {
    // `too-large` is a verdict on the body's size — the SDK's own or a 413 — so
    // it carries nothing about the endpoint's rate limit.
    const window = open(60_000)

    window.record({ kind: 'too-large' })
    expect(window.remainingMs()).toBe(60_000)
  })

  it('keeps the window when a retriable failure carries no header', () => {
    // A network error, a timeout and a header-less 503 are what the outage that
    // named the wait keeps producing; none of them revokes it.
    const window = open(300_000)
    vi.setSystemTime(Date.now() + 10_000)

    window.record({ kind: 'retry-later' })
    expect(window.remainingMs()).toBe(290_000)
  })

  it('installs a wait that arrives after the previous one has elapsed', () => {
    // A send can outlive the window it was made under, and the refusal it comes
    // back with names a deadline the endpoint still expects to be honored.
    const window = open(60_000)
    vi.setSystemTime(Date.now() + 60_000)

    window.record({ kind: 'retry-later', retryAfterMs: 300_000 })
    expect(window.remainingMs()).toBe(300_000)
  })

  it('caps a wait longer than the maximum when it is installed', () => {
    // `retryAfterMs` reaches the window from the exported host interfaces and
    // export outcomes, so it is not always a value the SDK parsed itself.
    const window = open(60 * 60_000)

    vi.setSystemTime(Date.now() + MAX_RETRY_AFTER_MS)
    expect(window.isOpen()).toBe(false)
  })

  it('ends the window on an outcome that is not a retry', () => {
    for (const outcome of [{ kind: 'ok' } as const, { kind: 'fatal' } as const]) {
      const window = open(60_000)
      window.record(outcome)
      expect(window.isOpen()).toBe(false)
    }
  })
})

import { parseRetryAfterMs } from '../posthog-core-stateless'

describe('parseRetryAfterMs', () => {
  const now = Date.parse('2026-09-01T12:00:00Z')

  it('reads delta-seconds', () => {
    expect(parseRetryAfterMs('60', now)).toBe(60_000)
    expect(parseRetryAfterMs('  7  ', now)).toBe(7_000)
  })

  it('reads an HTTP-date as a delay from now', () => {
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
})

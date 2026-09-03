import { formatTraceparent, normalizeTraceparent, parseTraceparent, sanitizeTracestate } from './traceparent'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'

describe('traceparent', () => {
  describe('parseTraceparent', () => {
    it('parses a sampled header', () => {
      expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-01`)).toEqual({
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        flags: '01',
      })
    })

    it('continues the trace even when the caller sampled it out, and keeps the flag', () => {
      // Every captured span is recorded, so honouring an inbound `00` by
      // dropping the parentage would orphan our own spans. The flag itself is
      // kept, so what we propagate onward still says what the caller decided.
      expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-00`)).toEqual({
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        flags: '00',
      })
    })

    it.each([
      ['a reserved bit alongside sampled', '05', '01'],
      ['reserved bits with sampled unset', '04', '00'],
      ['every bit set', 'ff', '01'],
    ])('zeroes %s, which version 00 does not define', (_label, inbound, expected) => {
      // We re-emit under version `00`, and W3C requires a vendor to zero every
      // flag that version does not define rather than forward it.
      expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-${inbound}`)?.flags).toBe(expected)
    })

    it('accepts a future version with extra fields', () => {
      expect(parseTraceparent(`01-${TRACE_ID}-${SPAN_ID}-01-something`)).toEqual({
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        flags: '01',
      })
    })

    it('rejects version 00 with extra fields, which only a higher version may carry', () => {
      // W3C defines version 00 as exactly three fields. A peer that follows the
      // spec restarts the trace here, so continuing it would split the trace in
      // half across the two services.
      expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-01-something`)).toBeUndefined()
      expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-01-`)).toBeUndefined()
    })

    it('trims surrounding whitespace', () => {
      expect(parseTraceparent(`  00-${TRACE_ID}-${SPAN_ID}-01 `)).toEqual({
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        flags: '01',
      })
    })

    it('rejects uppercase hex, which W3C requires a vendor to ignore', () => {
      expect(parseTraceparent(`00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`)).toBeUndefined()
      expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID.toUpperCase()}-01`)).toBeUndefined()
    })

    it.each([
      ['garbage', 'garbage'],
      ['an empty string', ''],
      ['version ff', `ff-${TRACE_ID}-${SPAN_ID}-01`],
      ['an all-zero trace id', `00-${'0'.repeat(32)}-${SPAN_ID}-01`],
      ['an all-zero span id', `00-${TRACE_ID}-${'0'.repeat(16)}-01`],
      ['a short trace id', `00-abc-${SPAN_ID}-01`],
      ['a missing field', `00-${TRACE_ID}-${SPAN_ID}`],
      ['a non-string', 42],
      ['undefined', undefined],
    ])('returns undefined for %s', (_name, value) => {
      expect(parseTraceparent(value)).toBeUndefined()
    })
  })

  describe('formatTraceparent', () => {
    it('sets the sampled flag on a trace started here', () => {
      expect(formatTraceparent(TRACE_ID, SPAN_ID)).toBe(`00-${TRACE_ID}-${SPAN_ID}-01`)
    })

    it('propagates the flags byte it was given', () => {
      expect(formatTraceparent(TRACE_ID, SPAN_ID, '00')).toBe(`00-${TRACE_ID}-${SPAN_ID}-00`)
    })

    it('round-trips through the parser', () => {
      expect(parseTraceparent(formatTraceparent(TRACE_ID, SPAN_ID))).toEqual({
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        flags: '01',
      })
    })
  })

  describe('sanitizeTracestate', () => {
    it('preserves a valid vendor list unchanged', () => {
      expect(sanitizeTracestate('vendor=abc,other=def')).toBe('vendor=abc,other=def')
    })

    it('trims surrounding whitespace', () => {
      expect(sanitizeTracestate('  vendor=abc  ')).toBe('vendor=abc')
    })

    it.each([
      ['an empty string', ''],
      ['a member without a value', 'vendor'],
      ['a non-string', 42],
      ['undefined', undefined],
      ['more than 32 members', Array.from({ length: 33 }, (_v, i) => `k${i}=v`).join(',')],
      ['an overlong value', `vendor=${'a'.repeat(600)}`],
    ])('discards %s', (_name, value) => {
      expect(sanitizeTracestate(value)).toBeUndefined()
    })
  })
})

describe('tracestate character safety', () => {
  it('discards a value carrying CRLF or a lone surrogate', () => {
    expect(sanitizeTracestate('vendor=abc\r\nx-injected: 1')).toBeUndefined()
    expect(sanitizeTracestate('vendor=\ud800')).toBeUndefined()
  })

  it('keeps a tab-separated vendor list, which W3C allows', () => {
    expect(sanitizeTracestate('rojo=00f067aa0ba902b7,\tcongo=t61rcWkgMzE')).toBe(
      'rojo=00f067aa0ba902b7,\tcongo=t61rcWkgMzE'
    )
  })

  it('keeps an ordinary vendor list', () => {
    expect(sanitizeTracestate('rojo=00f067aa0ba902b7,congo=t61rcWkgMzE')).toBe(
      'rojo=00f067aa0ba902b7,congo=t61rcWkgMzE'
    )
  })
})

describe('normalizeTraceparent', () => {
  it('carries version and flags through as received', () => {
    expect(normalizeTraceparent(`00-${TRACE_ID}-${SPAN_ID}-00`)).toBe(`00-${TRACE_ID}-${SPAN_ID}-00`)
    expect(normalizeTraceparent(`01-${TRACE_ID}-${SPAN_ID}-01`)).toBe(`01-${TRACE_ID}-${SPAN_ID}-01`)
  })

  it("trims surrounding whitespace, and drops a higher version's trailing fields", () => {
    expect(normalizeTraceparent(`  01-${TRACE_ID}-${SPAN_ID}-01-extra `)).toBe(`01-${TRACE_ID}-${SPAN_ID}-01`)
  })

  it.each([
    ['a malformed header', 'not-a-traceparent'],
    ['the invalid ff version', `ff-${TRACE_ID}-${SPAN_ID}-01`],
    ['an all-zero trace id', `00-${'0'.repeat(32)}-${SPAN_ID}-01`],
    ['version 00 with trailing fields', `00-${TRACE_ID}-${SPAN_ID}-01-extra`],
    ['an uppercase trace id', `00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`],
    ['a non-string', ['a', 'b']],
  ])('rejects %s', (_name, value) => {
    expect(normalizeTraceparent(value)).toBeUndefined()
  })
})

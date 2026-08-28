import { formatTraceparent, parseTraceparent, sanitizeTracestate } from './traceparent'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'

describe('traceparent', () => {
  describe('parseTraceparent', () => {
    it('parses a sampled header', () => {
      expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-01`)).toEqual({ traceId: TRACE_ID, spanId: SPAN_ID })
    })

    it('continues the trace even when the caller sampled it out', () => {
      // We record every captured span in v1, so honouring an inbound `00` would
      // orphan our own spans rather than save anything.
      expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-00`)).toEqual({ traceId: TRACE_ID, spanId: SPAN_ID })
    })

    it('accepts a future version with extra fields', () => {
      expect(parseTraceparent(`01-${TRACE_ID}-${SPAN_ID}-01-something`)).toEqual({
        traceId: TRACE_ID,
        spanId: SPAN_ID,
      })
    })

    it('normalizes case and surrounding whitespace', () => {
      expect(parseTraceparent(`  00-${TRACE_ID.toUpperCase()}-${SPAN_ID.toUpperCase()}-01 `)).toEqual({
        traceId: TRACE_ID,
        spanId: SPAN_ID,
      })
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
    it('always sets the sampled flag', () => {
      expect(formatTraceparent(TRACE_ID, SPAN_ID)).toBe(`00-${TRACE_ID}-${SPAN_ID}-01`)
    })

    it('round-trips through the parser', () => {
      expect(parseTraceparent(formatTraceparent(TRACE_ID, SPAN_ID))).toEqual({ traceId: TRACE_ID, spanId: SPAN_ID })
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

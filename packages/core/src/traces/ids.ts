// W3C Trace Context identifier generation.
//
// Trace ids are 16 bytes, span ids 8, both lowercase hex on the JSON wire. The
// ingestion service *zeroes* ids that aren't exactly the right length rather
// than rejecting them, which silently orphans the span — so length is
// load-bearing and every id is validated before it goes out.

const TRACE_ID_BYTES = 16
const SPAN_ID_BYTES = 8

const TRACE_ID_HEX = TRACE_ID_BYTES * 2
const SPAN_ID_HEX = SPAN_ID_BYTES * 2

const INVALID_TRACE_ID = '0'.repeat(TRACE_ID_HEX)
const INVALID_SPAN_ID = '0'.repeat(SPAN_ID_HEX)

const HEX_RE = /^[0-9a-f]+$/

type CryptoLike = { getRandomValues?: (array: Uint8Array) => Uint8Array }

/**
 * Random bytes from the platform's CSPRNG, falling back to `Math.random`.
 *
 * The fallback exists for React Native, which has no global `crypto` without a
 * polyfill — the same reason core's vendored uuidv7 takes that path. Trace ids
 * only need collision resistance, not unpredictability, so the fallback is
 * acceptable; browsers, Node and edge runtimes all take the CSPRNG path.
 */
export function getRandomBytes(byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength)
  const cryptoLike = (globalThis as { crypto?: CryptoLike }).crypto
  if (cryptoLike && typeof cryptoLike.getRandomValues === 'function') {
    try {
      cryptoLike.getRandomValues(bytes)
      return bytes
    } catch {
      // Fall through to Math.random below.
    }
  }
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = Math.floor(Math.random() * 256)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

function randomHexId(byteLength: number): string {
  const hex = bytesToHex(getRandomBytes(byteLength))
  // An all-zero id is invalid per W3C, and the server treats one as absent
  // rather than rejecting it — the span would be stored and silently orphaned.
  // Unreachable from a real random source; this only guards a broken one.
  return /[^0]/.test(hex) ? hex : hex.slice(0, -1) + '1'
}

export function newTraceId(): string {
  return randomHexId(TRACE_ID_BYTES)
}

export function newSpanId(): string {
  return randomHexId(SPAN_ID_BYTES)
}

function isValidHexId(value: unknown, length: number, invalid: string): value is string {
  return typeof value === 'string' && value.length === length && value !== invalid && HEX_RE.test(value)
}

export function isValidTraceId(value: unknown): value is string {
  return isValidHexId(value, TRACE_ID_HEX, INVALID_TRACE_ID)
}

export function isValidSpanId(value: unknown): value is string {
  return isValidHexId(value, SPAN_ID_HEX, INVALID_SPAN_ID)
}

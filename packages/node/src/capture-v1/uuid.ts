const HYPHENATED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_32 = /^[0-9a-f]{32}$/i
const URN_PREFIX = 'urn:uuid:'

/**
 * The lowercase, hyphenated form of an RFC 4122 uuid string, or undefined for anything else.
 * Accepts 32 hex digits, the hyphenated form, the hyphenated form in braces, and the
 * `urn:uuid:` form, in any case.
 */
export function canonicalizeUuid(value: string): string | undefined {
  let hyphenated = value
  if (value.length === 38 && value.startsWith('{') && value.endsWith('}')) {
    hyphenated = value.slice(1, -1)
  } else if (value.length === 45 && value.slice(0, URN_PREFIX.length).toLowerCase() === URN_PREFIX) {
    hyphenated = value.slice(URN_PREFIX.length)
  } else if (HEX_32.test(value)) {
    hyphenated = `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
  }
  return HYPHENATED.test(hyphenated) ? hyphenated.toLowerCase() : undefined
}

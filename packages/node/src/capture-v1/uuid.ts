import { V7Generator } from '@posthog/core'

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

type CryptoLike = { getRandomValues(array: Uint32Array): Uint32Array }

/** 32-bit words from the platform's cryptographic source, filled eight at a time to keep the per-uuid cost low. */
class CryptoRandom {
  private readonly words = new Uint32Array(8)
  private cursor = this.words.length

  constructor(private readonly crypto: CryptoLike) {}

  nextUint32(): number {
    if (this.cursor >= this.words.length) {
      this.crypto.getRandomValues(this.words)
      this.cursor = 0
    }
    return this.words[this.cursor++]
  }
}

function cryptoRandom(): CryptoRandom | undefined {
  const crypto = (globalThis as { crypto?: Partial<CryptoLike> }).crypto
  return typeof crypto?.getRandomValues === 'function' ? new CryptoRandom(crypto as CryptoLike) : undefined
}

// Without a crypto source (none in supported Node and edge runtimes), the core generator's Math.random source is used.
const generator = new V7Generator(cryptoRandom())

/** A v7 uuid for an event or a personless distinct id, with random bits from `crypto.getRandomValues`. */
export function eventUuidv7(): string {
  return generator.generate().toString()
}

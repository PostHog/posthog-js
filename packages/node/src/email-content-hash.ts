/// <reference lib="dom" />

/** The published parts of an email that a recipient gets. An absent part hashes as an empty string. */
export interface EmailContent {
  subject?: string
  preheader?: string
  html?: string
  text?: string
}

const HASH_PREFIX = 'v1:'
const ENCODING_HEADER = 'posthog-email-template-v1\n'
const HASHED_PARTS = ['subject', 'preheader', 'html', 'text'] as const

/**
 * The hash PostHog stores for a template's published content. The server computes the same bytes, so a send can say
 * which content the caller holds: the UTF-8 bytes of each part, line endings normalized, length-prefixed.
 */
export async function emailContentHash(content: EmailContent): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('SubtleCrypto API not available')
  }
  const digest = await subtle.digest('SHA-256', encode(content))
  return HASH_PREFIX + toHex(new Uint8Array(digest))
}

function encode(content: EmailContent): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = [encoder.encode(ENCODING_HEADER)]
  for (const part of HASHED_PARTS) {
    const bytes = encoder.encode(normalizeLineEndings(content[part] ?? ''))
    chunks.push(encoder.encode(`${bytes.length}:`), bytes, encoder.encode('\n'))
  }
  return concat(chunks)
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n')
}

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.length
  }
  return joined
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

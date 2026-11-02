/// <reference lib="dom" />

export interface EmailContent {
  subject?: string
  preheader?: string
  html?: string
  text?: string
}

const HASH_PREFIX = 'v1:'
const ENCODING_HEADER = 'posthog-email-template-v1\n'
const HASHED_PARTS = ['subject', 'preheader', 'html', 'text'] as const

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
  let encoded = ENCODING_HEADER
  for (const part of HASHED_PARTS) {
    const value = normalizeLineEndings(content[part] ?? '')
    encoded += `${encoder.encode(value).length}:${value}\n`
  }
  return encoder.encode(encoded)
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n')
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

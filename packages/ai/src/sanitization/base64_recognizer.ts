const DATA_URL_PREFIX_RE = /^data:([^;,\s]+)(?:;[^;,\s]+)*;base64,/i
const BASE64_ALPHABET_RE = /^[A-Za-z0-9+/_=-]+$/

export type Base64Recognition = { kind: 'data-url'; mediaType: string } | { kind: 'raw' } | { kind: 'none' }

export class Base64Recognizer {
  recognize(value: string, minLength: number): Base64Recognition {
    const dataUrl = DATA_URL_PREFIX_RE.exec(value)
    if (dataUrl) return { kind: 'data-url', mediaType: dataUrl[1] }

    if (value.length < minLength) return { kind: 'none' }

    const confidencePrefix = value.slice(0, minLength)
    if (BASE64_ALPHABET_RE.test(confidencePrefix)) {
      return { kind: 'raw' }
    } else {
      return { kind: 'none' }
    }
  }
}

import { toJsonSafeValue } from '@posthog/core'
import { formatToolResult } from '../src/toolResult'

const marker = '... [truncated]'
const client = (full: boolean) => ({ enableFullAiCapture: full })

const nonBinaryCases: Array<[string, () => unknown]> = [
  [
    'primitive and non-JSON values',
    () => ({
      missing: undefined,
      bigint: 12n,
      nan: NaN,
      infinity: Infinity,
      boolean: false,
      symbol: Symbol('named'),
      fn: () => undefined,
      loneSurrogate: '\ud800value\udc00',
    }),
  ],
  [
    'repeated references and cycles',
    () => {
      const shared = { answer: 42 }
      const root: any = { first: shared, second: shared }
      root.self = root
      return root
    },
  ],
  [
    'self-returning toJSON',
    () => {
      const value = {
        toJSON() {
          return value
        },
      }
      return value
    },
  ],
  [
    'throwing toJSON',
    () => ({
      value: 42,
      toJSON() {
        throw new Error('do not leak')
      },
    }),
  ],
  [
    'toJSON output',
    () => ({
      toJSON() {
        return { answer: 42, invalid: Infinity }
      },
    }),
  ],
  [
    'Date overrides',
    () => {
      const date = new Date('2026-01-02T03:04:05.000Z')
      date.toJSON = () => 'incorrect'
      date.toISOString = () => 'incorrect'
      return { date, invalid: new Date(NaN) }
    },
  ],
  ['enumerable __proto__ key', () => JSON.parse('{"__proto__":{"safe":true},"constructor":"kept"}')],
  [
    'throwing getter',
    () => ({
      get content() {
        throw new Error('do not leak')
      },
      after: 'later',
    }),
  ],
  [
    'throwing proxy',
    () =>
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('do not leak')
          },
        }
      ),
  ],
  [
    'revoked proxy',
    () => {
      const { proxy, revoke } = Proxy.revocable({}, {})
      revoke()
      return proxy
    },
  ],
  [
    'depth budget',
    () => {
      let deep: unknown = 'leaf'
      for (let depth = 0; depth < 30; depth++) deep = { nested: deep }
      return deep
    },
  ],
  ['array item budget', () => Array.from({ length: 1200 }, (_, index) => index)],
  [
    'object item budget',
    () => Object.fromEntries(Array.from({ length: 1200 }, (_, index) => [`field_${index}`, index])),
  ],
  ['node budget', () => Array.from({ length: 20 }, () => Array.from({ length: 900 }, () => ({ answer: 42 })))],
]

describe('shared tool-result normalization', () => {
  test.each(nonBinaryCases)(
    'preserves the existing JSON-safe contract for %s in both capture modes',
    (_name, create) => {
      for (const full of [false, true])
        expect(formatToolResult(create(), client(full))).toEqual(toJsonSafeValue(create()))
    }
  )

  test.each([
    ['ASCII exact boundary', '!'.repeat(5000), '!'.repeat(5000)],
    ['ASCII over boundary', '!'.repeat(5001), '!'.repeat(5000) + marker],
    ['four-byte codepoint across boundary', '!'.repeat(4999) + '😀', '!'.repeat(4999) + marker],
    ['two-byte codepoint boundary', 'é'.repeat(2501), 'é'.repeat(2500) + marker],
  ])('uses a 5000-byte payload plus 15-byte marker for %s', (_name, text, expected) => {
    expect(formatToolResult({ body: text, summary: 'later', nested: [text] })).toEqual({
      body: expected,
      summary: 'later',
      nested: [expected],
    })
    expect(new TextEncoder().encode(expected).byteLength).toBeLessThanOrEqual(5015)
    expect(formatToolResult(text, client(true))).toBe(text)
  })

  test('supports Claude’s separate original-span limit without changing keys or parsing text', () => {
    const key = '!'.repeat(6000)
    const jsonText = '{"answer":42}'
    const value = { [key]: '!'.repeat(200001), jsonText }
    const output = formatToolResult(value, undefined, 200000) as Record<string, string>
    expect(Object.keys(output)).toEqual([key, 'jsonText'])
    expect(output[key]).toBe('!'.repeat(200000) + marker)
    expect(output.jsonText).toBe(jsonText)
  })

  test.each([
    ['Buffer', () => Buffer.from([1, 2, 3, 4])],
    ['Uint8Array', () => new Uint8Array([1, 2, 3, 4])],
    [
      'toJSON-produced Buffer',
      () => ({
        toJSON() {
          return Buffer.from([1, 2, 3, 4])
        },
      }),
    ],
    [
      'toJSON-produced Uint8Array',
      () => ({
        toJSON() {
          return new Uint8Array([1, 2, 3, 4])
        },
      }),
    ],
  ] as const)('redacts %s before lossy JSON normalization while retaining media metadata', (_name, create) => {
    const value = { image: { mimeType: 'image/png', data: create() }, summary: 'later' }
    expect(formatToolResult(value)).toEqual({
      image: { mimeType: 'image/png', data: '[base64 image/png redacted]' },
      summary: 'later',
    })
    expect(formatToolResult(value, client(true))).toEqual(toJsonSafeValue(value))
    expect(value.image.data).not.toBe('[base64 image/png redacted]')
  })

  test('redacts nested binary from a custom toJSON result without modifying caller buffers', () => {
    const buffer = Buffer.from([1, 2, 3, 4])
    const value = {
      toJSON() {
        return { type: 'image', source: { media_type: 'image/png', data: buffer }, caption: 'later' }
      },
    }
    expect(formatToolResult(value)).toEqual({
      type: 'image',
      source: { media_type: 'image/png', data: '[base64 image/png redacted]' },
      caption: 'later',
    })
    expect([...buffer]).toEqual([1, 2, 3, 4])
  })

  test('retains shared binary aliases in full capture and safely redacts both references by default', () => {
    const shared = new Uint8Array([1, 2])
    const value = { first: shared, second: shared }
    expect(formatToolResult(value)).toEqual({ first: '[base64 redacted]', second: '[base64 redacted]' })
    expect(formatToolResult(value, client(true))).toEqual(toJsonSafeValue(value))
  })

  test('applies binary policy to recognized base64 and data URLs before truncation', () => {
    const value = {
      inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' },
      url: 'data:application/pdf;base64,aGVsbG8=',
      summary: 'later',
    }
    expect(formatToolResult(value)).toEqual({
      inlineData: { mimeType: 'image/png', data: '[base64 image/png redacted]' },
      url: '[base64 application/pdf redacted]',
      summary: 'later',
    })
    expect(formatToolResult(value, client(true))).toEqual(value)
  })
})

import { sanitizeEvent } from '../extensions/sanitization'
import { normalize, truncateEvent } from '../extensions/truncation'
import type { Event, StackFrame } from '../types'

describe('normalize - string truncation', () => {
  it('should leave short strings unchanged', () => {
    expect(normalize('hello')).toBe('hello')
  })

  it("should truncate strings exceeding maxStringLength with '...'", () => {
    const long = 'a'.repeat(33_000)
    const result = normalize(long) as string
    expect(result.length).toBe(32_768 + 3) // 32KB + "..."
    expect(result.endsWith('...')).toBe(true)
    expect(result.startsWith('a'.repeat(100))).toBe(true)
  })

  it('should leave strings at exactly maxStringLength unchanged', () => {
    const exact = 'a'.repeat(32_768)
    expect(normalize(exact)).toBe(exact)
  })
})

describe('normalize - non-serializable values', () => {
  it('should convert functions to descriptive string', () => {
    function myFunc() {}
    expect(normalize(myFunc)).toBe('[Function: myFunc]')
  })

  it('should convert anonymous functions', () => {
    expect(normalize(() => {})).toBe('[Function: <anonymous>]')
  })

  it('should convert symbols', () => {
    expect(normalize(Symbol('test'))).toBe('[Symbol(test)]')
    expect(normalize(Symbol.for(''))).toBe('[Symbol()]')
  })

  it('should convert undefined to string marker', () => {
    expect(normalize(undefined)).toBe('[undefined]')
  })

  it('should convert BigInt to string marker', () => {
    expect(normalize(BigInt(123))).toBe('[BigInt: 123]')
  })

  it('should convert NaN to string marker', () => {
    expect(normalize(Number.NaN)).toBe('[NaN]')
  })

  it('should convert Infinity to string marker', () => {
    expect(normalize(Number.POSITIVE_INFINITY)).toBe('[Infinity]')
    expect(normalize(Number.NEGATIVE_INFINITY)).toBe('[-Infinity]')
  })

  it('should convert Date to ISO string', () => {
    const date = new Date('2025-01-15T12:00:00Z')
    expect(normalize(date)).toBe('2025-01-15T12:00:00.000Z')
  })

  it('should handle Invalid Date gracefully', () => {
    expect(normalize(new Date('not-a-date'))).toBe('[Invalid Date]')
  })

  it('should pass through numbers unchanged', () => {
    expect(normalize(42)).toBe(42)
    expect(normalize(0)).toBe(0)
    expect(normalize(-3.14)).toBe(-3.14)
  })

  it('should pass through booleans unchanged', () => {
    expect(normalize(true)).toBe(true)
    expect(normalize(false)).toBe(false)
  })

  it('should pass through null as null', () => {
    expect(normalize(null)).toBeNull()
  })
})

describe('normalize - depth limiting', () => {
  it("should collapse objects beyond max depth to '[Object]'", () => {
    let obj: any = { value: 'deep' }
    for (let i = 0; i < 15; i++) {
      obj = { nested: obj }
    }
    const result = normalize(obj, 5) as any
    expect(result.nested.nested.nested.nested.nested).toBe('[Object]')
  })

  it("should collapse arrays beyond max depth to '[Array]'", () => {
    let arr: any = ['leaf']
    for (let i = 0; i < 15; i++) {
      arr = [arr]
    }
    const result = normalize(arr, 3) as any
    expect(result[0][0][0]).toBe('[Array]')
  })

  it('should handle depth=0 by collapsing top-level objects', () => {
    expect(normalize({ a: 1 }, 0)).toBe('[Object]')
    expect(normalize([1, 2], 0)).toBe('[Array]')
  })

  it('should not collapse primitives regardless of depth', () => {
    expect(normalize('hello', 0)).toBe('hello')
    expect(normalize(42, 0)).toBe(42)
  })
})

describe('normalize - breadth limiting', () => {
  it('should limit object properties to maxBreadth', () => {
    const wide: Record<string, number> = {}
    for (let i = 0; i < 150; i++) {
      wide[`key${i}`] = i
    }
    const result = normalize(wide, 10, 5) as Record<string, unknown>
    const keys = Object.keys(result)
    expect(keys.length).toBe(6) // 5 real keys + 1 sentinel key
    expect(result['...']).toBe('[MaxProperties ~]')
  })

  it('should limit array elements to maxBreadth', () => {
    const wide = Array.from({ length: 150 }, (_, i) => i)
    const result = normalize(wide, 10, 5) as unknown[]
    expect(result.length).toBe(6) // 5 real elements + 1 sentinel
    expect(result[5]).toBe('[MaxProperties ~]')
  })

  it('should leave objects within breadth limit unchanged', () => {
    const obj = { a: 1, b: 2, c: 3 }
    const result = normalize(obj, 10, 100) as Record<string, unknown>
    expect(result).toEqual({ a: 1, b: 2, c: 3 })
  })
})

describe('normalize - circular reference detection', () => {
  it('should detect circular object references', () => {
    const obj: any = { a: 1 }
    obj.self = obj
    const result = normalize(obj) as any
    expect(result.a).toBe(1)
    expect(result.self).toBe('[Circular ~]')
  })

  it('should detect circular array references', () => {
    const arr: any[] = [1, 2]
    arr.push(arr)
    const result = normalize(arr) as any
    expect(result[0]).toBe(1)
    expect(result[1]).toBe(2)
    expect(result[2]).toBe('[Circular ~]')
  })

  it('should allow same object in different branches (not a cycle)', () => {
    const shared = { value: 'shared' }
    const obj = { a: shared, b: shared }
    const result = normalize(obj) as any
    expect(result.a).toEqual({ value: 'shared' })
    expect(result.b).toEqual({ value: 'shared' })
  })

  it('should detect deeply nested circular references', () => {
    const obj: any = { level1: { level2: { level3: {} } } }
    obj.level1.level2.level3.backToRoot = obj
    const result = normalize(obj) as any
    expect(result.level1.level2.level3.backToRoot).toBe('[Circular ~]')
  })
})

describe('normalize - undefined property handling', () => {
  it('should omit undefined object properties (matching JSON.stringify behavior)', () => {
    const obj = { a: 1, b: undefined, c: 'hello' }
    const result = normalize(obj) as Record<string, unknown>
    expect(result).toEqual({ a: 1, c: 'hello' })
    expect('b' in result).toBe(false)
  })

  it('should still convert top-level undefined to marker', () => {
    expect(normalize(undefined)).toBe('[undefined]')
  })
})

// --- truncateEvent tests ---

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt_1',
    sessionId: 'ses_1',
    eventType: 'mcp:tools/call',
    timestamp: new Date('2025-01-15T12:00:00Z'),
    ...overrides,
  } as Event
}

describe('truncateEvent - field-level string limits', () => {
  it('should truncate userIntent exceeding 2048 chars', () => {
    const event = makeEvent({ userIntent: 'x'.repeat(3000) })
    const result = truncateEvent(event)
    expect(result.userIntent!.length).toBe(2048 + 3)
    expect(result.userIntent!.endsWith('...')).toBe(true)
  })

  it('should truncate resourceName exceeding 256 chars', () => {
    const event = makeEvent({ resourceName: 't'.repeat(300) })
    const result = truncateEvent(event)
    expect(result.resourceName!.length).toBe(256 + 3)
    expect(result.resourceName!.endsWith('...')).toBe(true)
  })

  it('should truncate serverName, serverVersion, clientName, clientVersion exceeding 256 chars', () => {
    const event = makeEvent({
      serverName: 's'.repeat(300),
      serverVersion: 'v'.repeat(300),
      clientName: 'c'.repeat(300),
      clientVersion: 'cv'.repeat(200),
    })
    const result = truncateEvent(event)
    expect(result.serverName!.length).toBe(256 + 3)
    expect(result.serverVersion!.length).toBe(256 + 3)
    expect(result.clientName!.length).toBe(256 + 3)
    expect(result.clientVersion!.length).toBe(256 + 3)
  })

  it('should leave short field values unchanged', () => {
    const event = makeEvent({
      userIntent: 'Get weather',
      resourceName: 'fetch_weather',
      serverName: 'my-server',
    })
    const result = truncateEvent(event)
    expect(result.userIntent).toBe('Get weather')
    expect(result.resourceName).toBe('fetch_weather')
    expect(result.serverName).toBe('my-server')
  })

  it('should handle undefined/null fields gracefully', () => {
    const event = makeEvent({
      userIntent: undefined,
      resourceName: undefined,
      serverName: undefined,
    })
    const result = truncateEvent(event)
    expect(result.userIntent).toBeUndefined()
    expect(result.resourceName).toBeUndefined()
    expect(result.serverName).toBeUndefined()
  })
})

describe('truncateEvent - error field limits', () => {
  const makeFrames = (count: number): StackFrame[] =>
    Array.from({ length: count }, (_, i) => ({
      filename: `file${i}.ts`,
      function: `func${i}`,
      lineno: i + 1,
      in_app: true,
      platform: 'node:javascript' as const,
    }))

  const makeError = (value: string, frames?: StackFrame[]): Event['error'] => ({
    $exception_list: [
      {
        type: 'Error',
        value,
        mechanism: { type: 'generic', handled: true },
        ...(frames ? { stacktrace: { type: 'raw' as const, frames } } : {}),
      },
    ],
    $exception_level: 'error',
  })

  const firstException = (event: Event) => event.error!.$exception_list[0]

  it('should truncate exception value exceeding 2048 chars', () => {
    const result = truncateEvent(makeEvent({ error: makeError('e'.repeat(3000)) }))
    const value = firstException(result).value!
    expect(value.length).toBe(2048 + 3)
    expect(value.endsWith('...')).toBe(true)
  })

  it('should limit stack frames to 50 (first 25 + last 25)', () => {
    const result = truncateEvent(makeEvent({ error: makeError('test', makeFrames(80)) }))
    const frames = firstException(result).stacktrace!.frames!
    expect(frames.length).toBe(50)
    expect(frames[0].filename).toBe('file0.ts')
    expect(frames[24].filename).toBe('file24.ts')
    expect(frames[25].filename).toBe('file55.ts')
    expect(frames[49].filename).toBe('file79.ts')
  })

  it('should leave frames at exactly 50 unchanged', () => {
    const result = truncateEvent(makeEvent({ error: makeError('test', makeFrames(50)) }))
    expect(firstException(result).stacktrace!.frames!.length).toBe(50)
  })

  it('should handle an exception without a stacktrace', () => {
    const result = truncateEvent(makeEvent({ error: makeError('test') }))
    expect(firstException(result).value).toBe('test')
    expect(firstException(result).stacktrace).toBeUndefined()
  })
})

describe('truncateEvent - response content text truncation', () => {
  it('should truncate text content blocks exceeding 32KB', () => {
    const event = makeEvent({
      response: {
        content: [
          { type: 'text', text: 'x'.repeat(40_000) },
          { type: 'text', text: 'short' },
        ],
      },
    })
    const result = truncateEvent(event)
    expect(result.response.content[0].text.length).toBe(32_768 + 3)
    expect(result.response.content[0].text.endsWith('...')).toBe(true)
    expect(result.response.content[1].text).toBe('short')
  })
})

describe('truncateEvent - size targeting', () => {
  it('should leave small events unchanged', () => {
    const event = makeEvent({
      parameters: { query: 'hello' },
      response: { content: [{ type: 'text', text: 'world' }] },
    })
    const result = truncateEvent(event)
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(102_400)
    expect((result.parameters as any).query).toBe('hello')
  })

  it('should reduce depth progressively for events exceeding 100KB', () => {
    // Create a deeply nested structure that's large
    const bigNested: any = {}
    let current = bigNested
    for (let i = 0; i < 8; i++) {
      current.data = 'x'.repeat(15_000) // 15KB per level = ~120KB total
      current.next = {}
      current = current.next
    }
    current.data = 'leaf'

    const event = makeEvent({ parameters: bigNested })
    const result = truncateEvent(event)

    const size = new TextEncoder().encode(JSON.stringify(result)).length
    expect(size).toBeLessThanOrEqual(102_400)
  })

  it('should truncate largest string fields as last resort', () => {
    // Create event with a single huge string that exceeds 100KB even at depth 1
    const event = makeEvent({
      parameters: { data: 'x'.repeat(120_000) },
    })
    const result = truncateEvent(event)

    const size = new TextEncoder().encode(JSON.stringify(result)).length
    expect(size).toBeLessThanOrEqual(102_400)
  })

  it('should guarantee 100KB max for pathological payloads', () => {
    // Wide + deep + large strings
    const wide: Record<string, string> = {}
    for (let i = 0; i < 50; i++) {
      wide[`key${i}`] = 'v'.repeat(3000)
    }
    const event = makeEvent({
      parameters: wide,
      response: { data: 'r'.repeat(30_000) },
    })
    const result = truncateEvent(event)

    const size = new TextEncoder().encode(JSON.stringify(result)).length
    expect(size).toBeLessThanOrEqual(102_400)
  })

  it('should preserve timestamp as Date when last-resort truncation runs', () => {
    const ts = new Date('2025-01-15T12:00:00Z')
    const event = makeEvent({
      timestamp: ts,
      // Flat payload with multiple oversized strings: depth reduction won't help,
      // so this forces truncateLargestFields() to run.
      parameters: {
        a: 'x'.repeat(60_000),
        b: 'y'.repeat(60_000),
        c: 'z'.repeat(60_000),
        d: 'w'.repeat(60_000),
      },
    })

    const result = truncateEvent(event)

    // Use a realm-safe Date check — jest's module isolation makes
    // `structuredClone(date) instanceof Date` flaky across realms.
    expect(Object.prototype.toString.call(result.timestamp)).toBe('[object Date]')
    expect((result.timestamp as Date).toISOString()).toBe(ts.toISOString())
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(102_400)
  })
})

describe('truncateEvent - non-mutation', () => {
  it('should not mutate the original event object', () => {
    const longIntent = 'x'.repeat(3000)
    const event = makeEvent({
      userIntent: longIntent,
      parameters: { deep: { nested: { data: 'y'.repeat(40_000) } } },
      error: {
        $exception_list: [
          {
            type: 'Error',
            value: 'e'.repeat(3000),
            mechanism: { type: 'generic', handled: true },
            stacktrace: {
              type: 'raw',
              frames: Array.from({ length: 80 }, (_, i) => ({
                filename: `file${i}.ts`,
                function: `func${i}`,
                in_app: true,
                platform: 'node:javascript' as const,
              })),
            },
          },
        ],
        $exception_level: 'error',
      },
    })

    // Deep clone for comparison
    const originalJson = JSON.stringify(event)
    truncateEvent(event)

    expect(JSON.stringify(event)).toBe(originalJson)
  })
})

describe('truncateEvent - edge cases', () => {
  it('should handle empty event with minimal fields', () => {
    const event = makeEvent({})
    const result = truncateEvent(event)
    expect(result.id).toBe('evt_1')
    expect(result.sessionId).toBe('ses_1')
  })

  it('should pass through already-small events unchanged', () => {
    const event = makeEvent({
      userIntent: 'Get weather',
      resourceName: 'fetch_weather',
      parameters: { location: 'SF' },
      response: { content: [{ type: 'text', text: '65F' }] },
    })
    const result = truncateEvent(event)
    expect(result.userIntent).toBe('Get weather')
    expect(result.resourceName).toBe('fetch_weather')
    expect((result.parameters as any).location).toBe('SF')
  })

  it('should handle event with null parameters and response', () => {
    const event = makeEvent({
      parameters: null,
      response: null,
      error: null as any,
    })
    const result = truncateEvent(event)
    expect(result.parameters).toBeNull()
    expect(result.response).toBeNull()
  })

  it('should preserve SDK-controlled fields exactly', () => {
    const ts = new Date('2025-01-15T12:00:00Z')
    const event = makeEvent({
      id: 'evt_abc123',
      sessionId: 'ses_xyz789',
      apiKey: 'proj_test',
      eventType: 'mcp:tools/call',
      timestamp: ts,
      duration: 342,
      sdkLanguage: 'typescript',
      sdkVersion: '0.1.12',
      ipAddress: '192.168.1.1',
      isError: false,
    })
    const result = truncateEvent(event)
    expect(result.id).toBe('evt_abc123')
    expect(result.sessionId).toBe('ses_xyz789')
    expect(result.apiKey).toBe('proj_test')
    expect(result.eventType).toBe('mcp:tools/call')
    expect(result.timestamp).toBe(ts)
    expect(result.duration).toBe(342)
    expect(result.sdkLanguage).toBe('typescript')
    expect(result.sdkVersion).toBe('0.1.12')
    expect(result.ipAddress).toBe('192.168.1.1')
    expect(result.isError).toBe(false)
  })
})

describe('truncateEvent - integration with sanitization pipeline', () => {
  it('should work correctly after sanitizeEvent in the pipeline', () => {
    const event = makeEvent({
      userIntent: 'x'.repeat(3000),
      parameters: {
        imageData: `${'A'.repeat(12_000)}=`, // large base64 — sanitization will redact this
        query: 'hello',
        nested: { deep: { value: 'y'.repeat(40_000) } },
      },
      response: {
        content: [
          { type: 'text', text: 'z'.repeat(40_000) },
          { type: 'image', data: 'base64img', mimeType: 'image/png' },
        ],
      },
    })

    // Simulate pipeline: sanitize then truncate
    const sanitized = sanitizeEvent(event)
    const result = truncateEvent(sanitized)

    // Sanitization should have redacted the base64 and image
    expect((result.parameters as any).imageData).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
    expect(result.response.content[1]).toEqual({
      type: 'text',
      text: '[image content redacted - not supported by PostHog MCP analytics]',
    })

    // Truncation should have capped the remaining fields
    expect(result.userIntent!.length).toBe(2048 + 3)
    expect(result.response.content[0].text.length).toBeLessThanOrEqual(32_768 + 3)
    expect((result.parameters as any).query).toBe('hello')
  })
})

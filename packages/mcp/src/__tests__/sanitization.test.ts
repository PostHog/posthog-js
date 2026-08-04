import { sanitizeEvent } from '../extensions/sanitization'
import type { Event } from '../types'

function makeLargeBase64(sizeInChars = 12_000): string {
  return `${'A'.repeat(sizeInChars - 1)}=`
}

function makeLargeBase64Url(sizeInBytes = 9_000): string {
  return Buffer.from(Array.from({ length: sizeInBytes }, (_, index) => index % 256)).toString('base64url')
}

function makeLargeBase64DataUrl(sizeInChars = 12_000, lineEnding?: '\n' | '\r\n'): string {
  const payload = makeLargeBase64(sizeInChars)
  const encodedPayload = lineEnding ? payload.match(/.{1,76}/g)!.join(lineEnding) : payload
  return `data:image/png;base64,${encodedPayload}`
}

function makeLargeNonBase64(sizeInChars = 12_000): string {
  return 'Hello, world! This is NOT base64. '.repeat(Math.ceil(sizeInChars / 34))
}

function makeEvent(overrides: Partial<Event>): Event {
  return {
    id: 'evt_1',
    sessionId: 'ses_1',
    eventType: 'mcp:tools/call',
    timestamp: new Date(),
    ...overrides,
  } as Event
}

describe('sanitizeEvent - response content blocks', () => {
  it('should replace image and audio blocks but keep text blocks', () => {
    const event = makeEvent({
      response: {
        content: [
          { type: 'text', text: 'Hello world' },
          { type: 'image', data: 'base64imagedata...', mimeType: 'image/png' },
          { type: 'audio', data: 'base64audiodata...', mimeType: 'audio/wav' },
        ],
      },
    })

    const result = sanitizeEvent(event)

    expect(result.response.content).toHaveLength(3)
    expect(result.response.content[0]).toEqual({
      type: 'text',
      text: 'Hello world',
    })
    expect(result.response.content[1]).toEqual({
      type: 'text',
      text: '[image content redacted - not supported by PostHog MCP analytics]',
    })
    expect(result.response.content[2]).toEqual({
      type: 'text',
      text: '[audio content redacted - not supported by PostHog MCP analytics]',
    })
  })

  it('should leave text-only content unchanged', () => {
    const event = makeEvent({
      response: {
        content: [
          { type: 'text', text: 'First' },
          { type: 'text', text: 'Second' },
        ],
      },
    })

    const result = sanitizeEvent(event)

    expect(result.response.content).toEqual([
      { type: 'text', text: 'First' },
      { type: 'text', text: 'Second' },
    ])
  })

  it('should redact EmbeddedResource with blob', () => {
    const event = makeEvent({
      response: {
        content: [
          {
            type: 'resource',
            resource: {
              uri: 'file:///data.bin',
              blob: 'base64blobdata...',
              mimeType: 'application/octet-stream',
            },
          },
        ],
      },
    })

    const result = sanitizeEvent(event)

    expect(result.response.content[0]).toEqual({
      type: 'text',
      text: '[binary resource content redacted - not supported by PostHog MCP analytics]',
    })
  })

  it('should pass through EmbeddedResource with text', () => {
    const textResource = {
      type: 'resource',
      resource: {
        uri: 'file:///readme.txt',
        text: 'This is a text resource',
        mimeType: 'text/plain',
      },
    }

    const event = makeEvent({
      response: { content: [textResource] },
    })

    const result = sanitizeEvent(event)

    expect(result.response.content[0]).toEqual(textResource)
  })

  it('should redact unknown content types with type name in message', () => {
    const event = makeEvent({
      response: {
        content: [{ type: 'video', data: 'somestuff', mimeType: 'video/mp4' }],
      },
    })

    const result = sanitizeEvent(event)

    expect(result.response.content[0]).toEqual({
      type: 'text',
      text: '[unsupported content type "video" redacted - not supported by PostHog MCP analytics]',
    })
  })

  it('should pass through resource_link unchanged', () => {
    const resourceLink = {
      type: 'resource_link',
      uri: 'file:///some/resource',
      name: 'My Resource',
    }

    const event = makeEvent({
      response: { content: [resourceLink] },
    })

    const result = sanitizeEvent(event)

    expect(result.response.content[0]).toEqual(resourceLink)
  })

  it('should redact large base64 inside structuredContent', () => {
    const largeBase64 = makeLargeBase64()

    const event = makeEvent({
      response: {
        structuredContent: {
          data: largeBase64,
          label: 'some label',
        },
      },
    })

    const result = sanitizeEvent(event)

    expect(result.response.structuredContent.data).toBe(
      '[binary data redacted - not supported by PostHog MCP analytics]'
    )
    expect(result.response.structuredContent.label).toBe('some label')
  })

  it('should handle response without content array', () => {
    const event = makeEvent({
      response: { result: 'success' },
    })

    const result = sanitizeEvent(event)

    expect(result.response).toEqual({ result: 'success' })
  })

  it('should redact token-shaped fields and PostHog tokens in text responses', () => {
    const event = makeEvent({
      response: {
        content: [
          {
            type: 'text',
            text: 'Project api_token: phc_123456789012345678901234567890',
          },
        ],
        structuredContent: {
          project: 'Default project',
          api_token: 'phc_123456789012345678901234567890',
        },
      },
    })

    const result = sanitizeEvent(event)

    expect(result.response.content[0].text).toBe('Project api_token: [redacted]')
    expect(result.response.structuredContent).toEqual({
      project: 'Default project',
      api_token: '[redacted]',
    })
  })

  it('should handle null and undefined response without error', () => {
    const resultNull = sanitizeEvent(makeEvent({ response: null }))
    const resultUndef = sanitizeEvent(makeEvent({ response: undefined }))

    expect(resultNull.response).toBeNull()
    expect(resultUndef.response).toBeUndefined()
  })
})

describe('sanitizeEvent - parameter scanning', () => {
  it('should leave small strings unchanged', () => {
    const event = makeEvent({
      parameters: {
        name: 'hello',
        query: 'some query text',
      },
    })

    const result = sanitizeEvent(event)

    expect(result.parameters).toEqual({
      name: 'hello',
      query: 'some query text',
    })
  })

  it('should redact large base64 strings (>10KB)', () => {
    const largeBase64 = makeLargeBase64()

    const event = makeEvent({
      parameters: { imageData: largeBase64 },
    })

    const result = sanitizeEvent(event)

    expect(result.parameters.imageData).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
  })

  it('should redact large base64url strings (>10KB)', () => {
    const largeBase64Url = makeLargeBase64Url()

    const event = makeEvent({
      parameters: { imageData: largeBase64Url },
    })

    const result = sanitizeEvent(event)

    expect(result.parameters.imageData).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
  })

  it('should redact valid low-entropy base64url strings', () => {
    const largeBase64Url = Buffer.alloc(9_000, 0xff).toString('base64url')

    const event = makeEvent({
      parameters: { imageData: largeBase64Url },
    })

    const result = sanitizeEvent(event)

    expect(result.parameters.imageData).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
  })

  it('should redact large base64 data URLs (>10KB)', () => {
    const largeDataUrl = makeLargeBase64DataUrl()

    const event = makeEvent({
      parameters: { imageData: largeDataUrl },
    })

    const result = sanitizeEvent(event)

    expect(result.parameters.imageData).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
  })

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ] as const)('should redact large base64 data URLs with %s-wrapped payloads', (_name, lineEnding) => {
    const wrappedDataUrl = makeLargeBase64DataUrl(12_000, lineEnding)

    const event = makeEvent({
      parameters: { imageData: wrappedDataUrl },
    })

    const result = sanitizeEvent(event)

    expect(result.parameters.imageData).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
  })

  it('should redact large base64 data URLs with percent-encoded payload characters', () => {
    const payload = Buffer.from(Array.from({ length: 9_000 }, (_, index) => index % 256)).toString('base64')
    const encodedPayload = payload.replace(/[+/=]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)
    const dataUrl = `data:application/octet-stream;base64,${encodedPayload}`

    const result = sanitizeEvent(makeEvent({ parameters: { dataUrl } }))

    expect(result.parameters.dataUrl).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
  })

  it('should leave long non-base64 data URLs and CRLF-wrapped ordinary text unchanged', () => {
    const dataUrlWithoutBase64 = `data:text/plain,${'ordinary text payload!'.repeat(600)}`
    const invalidBase64DataUrl = `data:text/plain;base64,${'ordinary text payload!'.repeat(600)}`
    const malformedDataUrl = `data:application/octet-stream;base64,${'AAAA%ZZ'.repeat(1_500)}`
    const ordinaryText = `${'This is ordinary prose, not encoded data. '.repeat(150)}\r\n${'More ordinary prose. '.repeat(300)}`

    const event = makeEvent({
      parameters: { dataUrlWithoutBase64, invalidBase64DataUrl, malformedDataUrl, ordinaryText },
    })

    const result = sanitizeEvent(event)

    expect(result.parameters).toEqual({ dataUrlWithoutBase64, invalidBase64DataUrl, malformedDataUrl, ordinaryText })
  })

  it('should leave large non-base64 strings unchanged', () => {
    const largeText = makeLargeNonBase64()

    const event = makeEvent({
      parameters: { longText: largeText },
    })

    const result = sanitizeEvent(event)

    expect(result.parameters.longText).toBe(largeText)
  })

  it('should find and redact deeply nested large base64', () => {
    const largeBase64 = makeLargeBase64()

    const event = makeEvent({
      parameters: {
        level1: {
          level2: {
            level3: { data: largeBase64 },
          },
        },
      },
    })

    const result = sanitizeEvent(event)

    expect(result.parameters.level1.level2.level3.data).toBe(
      '[binary data redacted - not supported by PostHog MCP analytics]'
    )
  })

  it('should only redact large base64 in mixed-type parameters', () => {
    const largeBase64 = makeLargeBase64()

    const event = makeEvent({
      parameters: {
        count: 42,
        active: true,
        name: 'short string',
        binaryData: largeBase64,
        tags: ['a', 'b', 'c'],
      },
    })

    const result = sanitizeEvent(event)

    expect(result.parameters.count).toBe(42)
    expect(result.parameters.active).toBe(true)
    expect(result.parameters.name).toBe('short string')
    expect(result.parameters.binaryData).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
    expect(result.parameters.tags).toEqual(['a', 'b', 'c'])
  })

  it('should redact large base64 inside an array', () => {
    const largeBase64 = makeLargeBase64()

    const event = makeEvent({
      parameters: {
        items: ['small string', largeBase64, 'another small'],
      },
    })

    const result = sanitizeEvent(event)

    expect(result.parameters.items[0]).toBe('small string')
    expect(result.parameters.items[1]).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
    expect(result.parameters.items[2]).toBe('another small')
  })

  it('should redact base64 string at exactly SIZE_GATE boundary (10240 chars)', () => {
    const exactBoundary = makeLargeBase64(10_240)
    const belowBoundary = makeLargeBase64(10_239)

    const event = makeEvent({
      parameters: {
        atGate: exactBoundary,
        belowGate: belowBoundary,
      },
    })

    const result = sanitizeEvent(event)

    expect(result.parameters.atGate).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
    expect(result.parameters.belowGate).toBe(belowBoundary)
  })

  it('should handle null and undefined parameters without error', () => {
    const resultNull = sanitizeEvent(makeEvent({ parameters: null }))
    const resultUndef = sanitizeEvent(makeEvent({ parameters: undefined }))

    expect(resultNull.parameters).toBeNull()
    expect(resultUndef.parameters).toBeUndefined()
  })
})

describe('sanitizeEvent - exception values', () => {
  it('should redact PostHog tokens from every exception value without mutating the original', () => {
    const event = makeEvent({
      isError: true,
      error: {
        $exception_list: [
          {
            type: 'Error',
            value: 'Project token phc_123456789012345678901234567890',
            mechanism: { type: 'generic', handled: true },
          },
          {
            type: 'Error',
            value: 'Personal token phx_abcdefghijklmnopqrstuvwxyz1234',
            mechanism: { type: 'generic', handled: true },
          },
        ],
        $exception_level: 'error',
      },
    })

    const result = sanitizeEvent(event)

    expect(result.error?.$exception_list.map((exception) => exception.value)).toEqual([
      'Project token [redacted]',
      'Personal token [redacted]',
    ])
    expect(event.error?.$exception_list[0].value).toContain('phc_')
  })
})

describe('sanitizeEvent - integration', () => {
  it('should sanitize both parameters and response in a full event', () => {
    const largeBase64 = makeLargeBase64()

    const event = makeEvent({
      apiKey: 'proj_1',
      resourceName: 'my-tool',
      parameters: {
        imageData: largeBase64,
        query: 'hello',
      },
      response: {
        content: [
          { type: 'text', text: 'Result text' },
          { type: 'image', data: 'base64img', mimeType: 'image/png' },
        ],
      },
    })

    const result = sanitizeEvent(event)

    expect(result.parameters.imageData).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
    expect(result.parameters.query).toBe('hello')

    expect(result.response.content[0]).toEqual({
      type: 'text',
      text: 'Result text',
    })
    expect(result.response.content[1]).toEqual({
      type: 'text',
      text: '[image content redacted - not supported by PostHog MCP analytics]',
    })

    expect(result.id).toBe('evt_1')
    expect(result.sessionId).toBe('ses_1')
    expect(result.apiKey).toBe('proj_1')
    expect(result.resourceName).toBe('my-tool')
  })

  it('should not mutate the original event', () => {
    const largeBase64 = makeLargeBase64()

    const event = makeEvent({
      parameters: { imageData: largeBase64 },
      response: {
        content: [{ type: 'image', data: 'base64img', mimeType: 'image/png' }],
      },
    })

    const result = sanitizeEvent(event)

    // Original should be unchanged
    expect(event.parameters.imageData).toBe(largeBase64)
    expect(event.response.content[0].type).toBe('image')
    expect(event.response.content[0].data).toBe('base64img')

    // Result should be different
    expect(result.parameters.imageData).toBe('[binary data redacted - not supported by PostHog MCP analytics]')
    expect(result.response.content[0].type).toBe('text')
  })
})

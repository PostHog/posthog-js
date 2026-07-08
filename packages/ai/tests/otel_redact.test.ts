import type { ReadableSpan, TimedEvent } from '@opentelemetry/sdk-trace-base'
import type { Attributes } from '@opentelemetry/api'

import { redactSpan } from '../src/otel/redact'

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo'
const REDACTED_PNG = '[base64 image/png redacted]'
const LARGE_B64 = 'A'.repeat(2000)
const REDACTED_GENERIC = '[base64 redacted]'

function makeSpan(attributes: Attributes = {}, events: TimedEvent[] = []): ReadableSpan {
  return {
    name: 'gen_ai.chat',
    attributes,
    events,
    spanContext: () => ({ traceId: 't', spanId: 's', traceFlags: 1 }),
  } as unknown as ReadableSpan
}

describe('redactSpan', () => {
  it.each([
    [
      'a bare data URL (OpenInference flattened leaf)',
      'llm.input_messages.0.message.contents.0.message_content.image.image.url',
      DATA_URL,
      REDACTED_PNG,
    ],
    ['long raw base64 with no context via the weak threshold', 'traceloop.entity.input', LARGE_B64, REDACTED_GENERIC],
    [
      'data URLs inside a string-array attribute',
      'gen_ai.prompt.images',
      [DATA_URL, 'just text'],
      [REDACTED_PNG, 'just text'],
    ],
  ])('redacts %s', (_desc, key, input, expected) => {
    const out = redactSpan(makeSpan({ [key]: input }))

    expect(out.attributes[key]).toEqual(expected)
  })

  it('redacts data URLs nested inside a JSON-blob attribute (gen_ai.input.messages)', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', image_url: DATA_URL },
        ],
      },
    ]
    const span = makeSpan({ 'gen_ai.input.messages': JSON.stringify(messages) })

    const out = redactSpan(span)

    const parsed = JSON.parse(out.attributes['gen_ai.input.messages'] as string)
    expect(parsed[0].content[1].image_url).toBe(REDACTED_PNG)
    expect(parsed[0].content[0].text).toBe('what is this?')
  })

  it('redacts content carried in span events (gen_ai.content.prompt)', () => {
    const span = makeSpan({}, [
      { name: 'gen_ai.content.prompt', time: [0, 0], attributes: { 'gen_ai.prompt': DATA_URL } },
    ])

    const out = redactSpan(span)

    expect(out.events[0].attributes!['gen_ai.prompt']).toBe(REDACTED_PNG)
  })

  it('does not mutate the original span', () => {
    const attributes = { 'gen_ai.prompt': DATA_URL }
    const span = makeSpan(attributes)

    redactSpan(span)

    expect(span.attributes['gen_ai.prompt']).toBe(DATA_URL)
    expect(attributes['gen_ai.prompt']).toBe(DATA_URL)
  })

  it('returns the same span instance when nothing is redacted', () => {
    const span = makeSpan({ 'gen_ai.model': 'gpt-4', 'gen_ai.usage.input_tokens': 12 })

    expect(redactSpan(span)).toBe(span)
  })

  it('preserves prototype methods on the redacted copy', () => {
    const span = makeSpan({ 'gen_ai.prompt': DATA_URL })

    const out = redactSpan(span)

    expect(out.spanContext()).toEqual({ traceId: 't', spanId: 's', traceFlags: 1 })
    expect(out.name).toBe('gen_ai.chat')
  })

  it('preserves the original string when JSON has no binary content', () => {
    const json = JSON.stringify({ role: 'user', content: 'hello' })
    const span = makeSpan({ 'gen_ai.input.messages': json })

    expect(redactSpan(span)).toBe(span)
  })
})

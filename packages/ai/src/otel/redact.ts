import type { Attributes, AttributeValue } from '@opentelemetry/api'
import type { ReadableSpan, TimedEvent } from '@opentelemetry/sdk-trace-base'

import { BinaryContentRedactor } from '../sanitization/binary_content_redactor'

const redactor = new BinaryContentRedactor()

export function redactSpan(span: ReadableSpan): ReadableSpan {
  const attributes = span.attributes ? redactAttributes(span.attributes) : span.attributes
  const events = span.events ? redactEvents(span.events) : span.events
  if (attributes === span.attributes && events === span.events) {
    return span
  }
  // Copy rather than mutate: the span is shared across every registered processor/exporter.
  return Object.create(span, {
    attributes: { value: attributes, enumerable: true, configurable: true },
    events: { value: events, enumerable: true, configurable: true },
  })
}

function redactAttributes(attributes: Attributes): Attributes {
  let changed = false
  const out: Attributes = {}
  for (const key of Object.keys(attributes)) {
    const value = attributes[key]
    const redacted = value === undefined ? value : redactAttributeValue(value)
    if (redacted !== value) {
      changed = true
    }
    out[key] = redacted
  }
  return changed ? out : attributes
}

function redactEvents(events: TimedEvent[]): TimedEvent[] {
  let changed = false
  const out = events.map((event) => {
    if (!event.attributes) {
      return event
    }
    const attributes = redactAttributes(event.attributes)
    if (attributes === event.attributes) {
      return event
    }
    changed = true
    return { ...event, attributes }
  })
  return changed ? out : events
}

function redactAttributeValue(value: AttributeValue): AttributeValue {
  if (typeof value === 'string') {
    return redactString(value)
  }
  if (isStringArray(value)) {
    let changed = false
    const out = value.map((item) => {
      if (typeof item !== 'string') {
        return item
      }
      const redacted = redactString(item)
      if (redacted !== item) {
        changed = true
      }
      return redacted
    })
    return changed ? out : value
  }
  return value
}

function isStringArray(value: AttributeValue): value is Array<string | null | undefined> {
  return Array.isArray(value) && value.every((item) => typeof item !== 'number' && typeof item !== 'boolean')
}

function redactString(value: string): string {
  const trimmed = value.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const redacted = redactJson(value)
    if (redacted !== undefined) {
      return redacted
    }
  }
  return redactor.redact(value)
}

function redactJson(value: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') {
    return undefined
  }
  const redactedStr = JSON.stringify(redactor.redact(parsed))
  // Preserve the original string (and its formatting) when nothing was redacted.
  return redactedStr === JSON.stringify(parsed) ? value : redactedStr
}

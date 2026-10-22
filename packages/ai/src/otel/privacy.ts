import type { Attributes } from '@opentelemetry/api'
import type { ReadableSpan, TimedEvent } from '@opentelemetry/sdk-trace-base'

import { withAttributes } from './spans'

// Every attribute PostHog ingestion turns into prompt, output, tool call or error text. Ingestion
// keeps unmapped attributes as event properties, so this also covers attributes it does not map.
const CONTENT_ATTRIBUTES = new Set([
  // Vercel AI SDK
  'ai.prompt',
  'ai.prompt.messages',
  'ai.response.text',
  'ai.response.object',
  'ai.response.toolCalls',
  'ai.response.reasoning',
  'ai.response.reasoningDetails',
  'ai.response.files',
  'ai.toolCall.args',
  'ai.toolCall.result',
  'ai.value',
  'ai.values',
  'ai.embedding',
  'ai.embeddings',
  // OpenTelemetry GenAI semantic conventions
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.system_instructions',
  'gen_ai.prompt',
  'gen_ai.completion',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  // Traceloop / OpenLLMetry
  'traceloop.entity.input',
  'traceloop.entity.output',
  // Anthropic
  'anthropic.tool_result.content',
  // Pydantic AI / Logfire
  'pydantic_ai.all_messages',
  'final_result',
  'tool_arguments',
  'tool_response',
  'events',
  // OpenInference
  'input.value',
  'output.value',
  // Errors
  'exception.message',
  'exception.stacktrace',
  'error.message',
])

const CONTENT_ATTRIBUTE_PREFIXES = [
  'gen_ai.prompt.',
  'gen_ai.completion.',
  'llm.prompts.',
  'llm.completions.',
  'llm.input_messages.',
  'llm.output_messages.',
]

// GenAI semantic convention span events (`gen_ai.user.message`, `gen_ai.choice`, ...) carry
// message content under generic keys such as `content`.
const CONTENT_EVENT_PREFIX = 'gen_ai.'

const PROVIDER_METADATA_ATTRIBUTE = 'ai.response.providerMetadata'

const isContentAttribute = (key: string): boolean =>
  CONTENT_ATTRIBUTES.has(key) || CONTENT_ATTRIBUTE_PREFIXES.some((prefix) => key.startsWith(prefix))

// Provider metadata can carry content, such as Google grounding search queries. Ingestion only
// reads the Vercel AI Gateway cost from it.
function gatewayCostOnly(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  try {
    const cost: unknown = JSON.parse(value)?.gateway?.cost
    return typeof cost === 'number' || typeof cost === 'string' ? JSON.stringify({ gateway: { cost } }) : undefined
  } catch {
    return undefined
  }
}

function stripAttributes(attributes: Attributes): Attributes {
  const out: Attributes = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (isContentAttribute(key)) {
      continue
    }
    if (key === PROVIDER_METADATA_ATTRIBUTE) {
      const metadata = gatewayCostOnly(value)
      if (metadata !== undefined) {
        out[key] = metadata
      }
      continue
    }
    out[key] = value
  }
  return out
}

function stripEvents(events: TimedEvent[]): TimedEvent[] {
  return events
    .filter((event) => !event.name.startsWith(CONTENT_EVENT_PREFIX))
    .map((event) => (event.attributes ? { ...event, attributes: stripAttributes(event.attributes) } : event))
}

/** Returns a copy of the span without the attributes, events and status message that carry content. */
export function stripContent(span: ReadableSpan): ReadableSpan {
  const stripped = withAttributes(
    span,
    span.attributes ? stripAttributes(span.attributes) : span.attributes,
    span.events ? stripEvents(span.events) : span.events
  )
  if (span.status?.message) {
    Object.defineProperty(stripped, 'status', {
      value: { code: span.status.code },
      enumerable: true,
      configurable: true,
    })
  }
  return stripped
}

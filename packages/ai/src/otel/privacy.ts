import type { Attributes } from '@opentelemetry/api'
import type { ReadableSpan, TimedEvent } from '@opentelemetry/sdk-trace-base'

import { withAttributes } from './spans'
import { isToolDefinitionAttribute, withoutUnparseableToolDefinitions } from './toolDefinitions'

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
  'ai.documents',
  'ai.request.text',
  'ai.decision.state',
  'ai.decision.questions',
  'ai.decision.answers',
  // OpenTelemetry GenAI semantic conventions
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.system_instructions',
  'gen_ai.prompt',
  'gen_ai.completion',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'gen_ai.retrieval.documents',
  'gen_ai.retrieval.query.text',
  'gen_ai.memory.query.text',
  'gen_ai.memory.records',
  'gen_ai.evaluation.explanation',
  // Traceloop / OpenLLMetry
  'traceloop.entity.input',
  'traceloop.entity.output',
  'traceloop.prompt.template',
  'gen_ai.task.input',
  'gen_ai.task.output',
  'gen_ai.guardrail.input',
  'gen_ai.guardrail.output',
  'gen_ai.guardrail.error.message',
  'gen_ai.response.revised_prompt',
  'mcp.response.value',
  'db.marqo.search.query',
  // Anthropic
  'anthropic.tool_result.content',
  // Pydantic AI / Logfire
  'pydantic_ai.all_messages',
  'final_result',
  'tool_arguments',
  'tool_response',
  'events',
  'model_request_parameters',
  'inputs',
  'prompt',
  // OpenInference
  'input.value',
  'output.value',
  'llm.function_call',
  'llm.prompt_template.template',
  'llm.prompt_template.variables',
  // Holds request parameters such as Responses `instructions`.
  'llm.invocation_parameters',
  'reranker.query',
  // Langfuse
  'langfuse.trace.input',
  'langfuse.trace.output',
  'langfuse.observation.input',
  'langfuse.observation.output',
  'langfuse.observation.status_message',
  'langfuse.experiment.item.expected_output',
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
  'llm.choices.',
  'traceloop.prompt.template_variables.',
]

const CONTENT_ATTRIBUTE_PATTERNS = [
  /^db\.chroma\.(query|get|delete)\.where_document$/,
  /^embedding\.embeddings\.\d+\.embedding\.(text|vector)$/,
  /^retrieval\.documents\.\d+\.document\.(content|metadata)$/,
  /^reranker\.(input|output)_documents\.\d+\.document\.content$/,
  /^(input|output)\.images\.\d+\.image\.url$/,
  /^mastra\.[a-z_]+\.(input|output)$/,
]

// Prompt management metadata that shares the `gen_ai.prompt.` prefix with prompt content.
const NON_CONTENT_ATTRIBUTES = new Set(['gen_ai.prompt.name', 'gen_ai.prompt.version'])

// Ingestion only reads exception events. Every other event (GenAI semconv messages, vector
// database results, framework logs) can carry content.
const EXCEPTION_EVENT_NAME = 'exception'

const PROVIDER_METADATA_ATTRIBUTE = 'ai.response.providerMetadata'

const isContentAttribute = (key: string): boolean =>
  !NON_CONTENT_ATTRIBUTES.has(key) &&
  (CONTENT_ATTRIBUTES.has(key) ||
    CONTENT_ATTRIBUTE_PREFIXES.some((prefix) => key.startsWith(prefix) || prefix === `${key}.`) ||
    CONTENT_ATTRIBUTE_PATTERNS.some((pattern) => pattern.test(key)))

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
    if (isToolDefinitionAttribute(key)) {
      const definitions = value === undefined ? undefined : withoutUnparseableToolDefinitions(value)
      if (definitions !== undefined) {
        out[key] = definitions
      }
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
    .filter((event) => event.name === EXCEPTION_EVENT_NAME)
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

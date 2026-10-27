const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/i
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/i

// `@opentelemetry/api` v1 keeps its registered context manager on this global, so that all copies of the API share it.
// We read it here and do not import the optional peer: bundlers such as esbuild fail the build when an imported
// module is not installed, and an import from a variable makes webpack warn and drop the module.
const OTEL_API_GLOBAL_KEY = Symbol.for('opentelemetry.js.api.1')
const SPAN_CONTEXT_KEY = Symbol.for('OpenTelemetry Context Key SPAN')

type OtelSpan = { spanContext(): { traceId?: unknown; spanId?: unknown } }
type OtelContext = { getValue(key: symbol): unknown }
type OtelApiGlobal = { context?: { active(): OtelContext } }

export async function getActiveTraceProperties(): Promise<Record<string, string>> {
  try {
    const otelApi = (globalThis as Record<symbol, OtelApiGlobal | undefined>)[OTEL_API_GLOBAL_KEY]
    const span = otelApi?.context?.active().getValue(SPAN_CONTEXT_KEY) as OtelSpan | undefined
    const spanContext = span?.spanContext()
    const traceId = spanContext?.traceId
    const spanId = spanContext?.spanId

    if (
      typeof traceId === 'string' &&
      typeof spanId === 'string' &&
      TRACE_ID_PATTERN.test(traceId) &&
      SPAN_ID_PATTERN.test(spanId) &&
      !/^0+$/.test(traceId) &&
      !/^0+$/.test(spanId)
    ) {
      return { $trace_id: traceId.toLowerCase(), $span_id: spanId.toLowerCase() }
    }
  } catch {
    return {}
  }

  return {}
}

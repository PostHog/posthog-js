const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/i
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/i

let otelApi: Promise<typeof import('@opentelemetry/api')> | undefined

export async function getActiveTraceProperties(): Promise<Record<string, string>> {
  try {
    const api = await (otelApi ??= import('@opentelemetry/api'))
    const spanContext = api.trace.getActiveSpan()?.spanContext()
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

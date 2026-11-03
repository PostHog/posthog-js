import type { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

import type { SpanProcessor } from './types'

type LegacyTraceModule = {
  BatchSpanProcessor: new (exporter: OTLPTraceExporter) => SpanProcessor
}

type TraceModule = {
  BatchSpanProcessor: new (options: { exporter: OTLPTraceExporter }) => SpanProcessor
}

function isMissingPackage(error: unknown, name: string): boolean {
  const { code, message } = error as NodeJS.ErrnoException
  return (
    (code === 'MODULE_NOT_FOUND' && message.startsWith(`Cannot find module '${name}'`)) ||
    message === `Dynamic require of "${name}" is not supported`
  )
}

export function createBatchSpanProcessor(exporter: OTLPTraceExporter): SpanProcessor {
  let trace: TraceModule
  try {
    trace = require('@opentelemetry/sdk-trace') as TraceModule
  } catch (error) {
    if (!isMissingPackage(error, '@opentelemetry/sdk-trace')) {
      throw error
    }
    let legacy: LegacyTraceModule
    try {
      legacy = require('@opentelemetry/sdk-trace-base') as LegacyTraceModule
    } catch (legacyError) {
      if (isMissingPackage(legacyError, '@opentelemetry/sdk-trace-base')) {
        throw new Error('PostHogSpanProcessor requires @opentelemetry/sdk-trace or @opentelemetry/sdk-trace-base.', {
          cause: legacyError,
        })
      }
      throw legacyError
    }
    return new legacy.BatchSpanProcessor(exporter)
  }

  return new trace.BatchSpanProcessor({ exporter })
}

import { createRequire } from 'node:module'
import type { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

import type { SpanProcessor } from './types'

const require = createRequire(import.meta.url)

type LegacyTraceModule = {
  BatchSpanProcessor: new (exporter: OTLPTraceExporter) => SpanProcessor
}

type TraceModule = {
  BatchSpanProcessor: new (options: { exporter: OTLPTraceExporter }) => SpanProcessor
}

export function createBatchSpanProcessor(exporter: OTLPTraceExporter): SpanProcessor {
  try {
    require.resolve('@opentelemetry/sdk-trace')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
      throw error
    }
    const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base') as LegacyTraceModule
    return new BatchSpanProcessor(exporter)
  }

  const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace') as TraceModule
  return new BatchSpanProcessor({ exporter })
}

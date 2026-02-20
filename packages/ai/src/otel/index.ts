export { captureSpan } from './capture'
export { PostHogSpanProcessor, createPostHogSpanProcessor } from './processor'
export { aiSdkSpanMapper } from './mappers'
export type {
  PostHogTelemetryOptions,
  PostHogReadableSpan,
  PostHogTelemetrySpanProcessor,
  PostHogSpanMapper,
  PostHogSpanMapperResult,
  ShouldExportSpan,
} from './types'

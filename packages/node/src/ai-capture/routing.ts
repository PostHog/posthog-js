/** Queue route for events sent via `_captureAi`, isolated from analytics and Capture V1 routes. */
export const AI_CAPTURE_ROUTE = 'ai-capture'

/**
 * Dedicated AI ingestion endpoint (V0 wire format, served by the capture-ai deployment).
 * Kept as a single constant so the planned v1 cutover to `/i/v1/ai/events/` is a one-line swap.
 */
export const AI_CAPTURE_ENDPOINT_PATH = '/i/v0/ai/batch/'

/** Per-event ceiling; larger events are dropped. Matches posthog-python's AI lane cap. */
export const AI_MAX_EVENT_BYTES = 8 * 1024 * 1024

/**
 * Target body size per sub-batch. A single event may exceed it alone, so the worst-case body is
 * AI_BATCH_TARGET_BYTES + AI_MAX_EVENT_BYTES (~13MiB), under the 20MiB server cap.
 */
export const AI_BATCH_TARGET_BYTES = 5 * 1024 * 1024

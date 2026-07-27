import { PostHogEventProperties, safeJsonStringify } from '@posthog/core'

import { AI_BATCH_TARGET_BYTES, AI_MAX_EVENT_BYTES } from './routing'

const encoder = new TextEncoder()

export type AiBatchPartition = {
  batches: PostHogEventProperties[][]
  dropped: { event: string; bytes: number }[]
}

/**
 * Splits an AI batch into byte-bounded sub-batches: events over the per-event cap are dropped
 * (reported by name and size only — they may carry unredacted media), the rest greedily packed
 * under the target body size, a single event always allowed alone. Count-based batches of
 * multi-MB events would otherwise thrash the reactive 413-halving loop.
 */
export function partitionAiBatch(
  messages: (PostHogEventProperties | undefined)[],
  maxEventBytes: number = AI_MAX_EVENT_BYTES,
  targetBatchBytes: number = AI_BATCH_TARGET_BYTES
): AiBatchPartition {
  const batches: PostHogEventProperties[][] = []
  const dropped: { event: string; bytes: number }[] = []
  let current: PostHogEventProperties[] = []
  let currentBytes = 0

  for (const message of messages) {
    if (message === undefined) {
      continue
    }
    const bytes = encoder.encode(safeJsonStringify(message)).length
    if (bytes > maxEventBytes) {
      dropped.push({ event: typeof message.event === 'string' ? message.event : 'unknown', bytes })
      continue
    }
    if (current.length > 0 && currentBytes + bytes > targetBatchBytes) {
      batches.push(current)
      current = []
      currentBytes = 0
    }
    current.push(message)
    currentBytes += bytes
  }
  if (current.length > 0) {
    batches.push(current)
  }
  return { batches, dropped }
}

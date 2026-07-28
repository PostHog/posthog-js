import { PostHogEventProperties, safeJsonStringify } from '@posthog/core'

import { AI_BATCH_TARGET_BYTES, AI_MAX_EVENT_BYTES } from './routing'

const encoder = new TextEncoder()

export type AiBatchPartition = {
  batches: PostHogEventProperties[][]
  dropped: { event: string; bytes: number }[]
}

export function eventByteSize(message: PostHogEventProperties): number {
  return encoder.encode(safeJsonStringify(message)).length
}

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
    const bytes = eventByteSize(message)
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

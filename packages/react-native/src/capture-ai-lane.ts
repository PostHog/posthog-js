import { PostHogPersistedProperty, safeSetTimeout, type Logger, type PostHogEventProperties } from '@posthog/core'
import {
  canonicalizeUuid,
  serializeV1Event,
  wireProblem,
  type SerializedV1Event,
  type V1CaptureSender,
  type V1SendDeferral,
} from '@posthog/core/capture-v1'
import type { PostHogRNStorage } from './storage'

/** Capture drops AI events whose properties are over 8 MiB; the whole-event measure allows 64 KiB for the rest. */
export const CAPTURE_AI_DEFAULT_MAX_EVENT_BYTES = 8 * 1024 * 1024 + 64 * 1024
export const CAPTURE_AI_DEFAULT_MAX_QUEUE_SIZE = 100
export const CAPTURE_AI_DEFAULT_TIMEOUT_MS = 60_000
const CAPTURE_AI_MAX_QUEUE_BYTES = 50 * 1024 * 1024
// Each change rewrites the stored queue, so only the newest events that fit in this size are kept across restarts.
const CAPTURE_AI_MAX_PERSISTED_BYTES = 5 * 1024 * 1024
const CAPTURE_AI_BATCH_BYTE_TARGET = 5 * 1024 * 1024
const MAX_RESEND_WAIT_MS = 30_000

export interface CaptureAiLaneSettings {
  flushAt: number
  maxBatchSize: number
  flushIntervalMs: number
  maxQueueSize: number
  maxEventBytes: number
}

/**
 * How a queued AI event is stored across launches. It is written field by field rather than as core's
 * `SerializedV1Event`, so a change to that type can't silently drop events an earlier version queued.
 */
interface PersistedAiEvent {
  uuid: string
  json: string
  bytes: number
  propertiesBytes: number
}

const toPersisted = ({ uuid, json, bytes, propertiesBytes }: SerializedV1Event): PersistedAiEvent => ({
  uuid,
  json,
  bytes,
  propertiesBytes,
})

const isPersistedEvent = (item: unknown): item is PersistedAiEvent => {
  if (typeof item !== 'object' || item === null) {
    return false
  }
  const { uuid, json, bytes, propertiesBytes } = item as PersistedAiEvent
  return (
    typeof uuid === 'string' &&
    typeof json === 'string' &&
    typeof bytes === 'number' &&
    typeof propertiesBytes === 'number'
  )
}

/**
 * The `captureAi()` delivery lane: its own durable queue, flush cycle, resend wait and sender, so a
 * slow or failing AI upload never holds back analytics events, and the reverse. Events are queued
 * already serialized, so each one is serialized once.
 */
export class CaptureAiLane {
  private _chain: Promise<void> = Promise.resolve()
  private _automaticFlushQueued = false
  private _flushTimer?: ReturnType<typeof setTimeout>
  private _resendTimer?: ReturnType<typeof setTimeout>
  private _resendAt = 0
  private _resendCount = 0
  private _batchSize: number
  private _stopped = false
  private _events?: SerializedV1Event[]
  private _storageLoaded = false

  constructor(
    private readonly _storage: PostHogRNStorage,
    private readonly _settings: CaptureAiLaneSettings,
    private readonly _sender: () => V1CaptureSender,
    private readonly _logger: Logger
  ) {
    this._batchSize = _settings.maxBatchSize
    // Events left from an earlier launch are sent on the first timer flush.
    const scheduleLeftovers = (): void => {
      this._storageLoaded = true
      if (this._queue().length > 0) {
        this._scheduleFlush()
      }
    }
    if (_storage.preloadPromise) {
      void _storage.preloadPromise.then(scheduleLeftovers, () => {})
    } else {
      scheduleLeftovers()
    }
  }

  /** Queues an already built and normalized event and returns its uuid as sent; undefined when it is dropped instead. */
  enqueue(message: PostHogEventProperties): string | undefined {
    if (this._stopped) {
      return undefined
    }
    const name = String(message.event)
    const problem = wireProblem(message)
    if (problem) {
      this._logger.warn(`Dropping AI event "${name}": ${problem}.`)
      return undefined
    }
    let event: SerializedV1Event
    try {
      const uuid = typeof message.uuid === 'string' ? canonicalizeUuid(message.uuid) : undefined
      event = serializeV1Event(uuid ? { ...message, uuid } : message)
    } catch (e) {
      this._logger.error(`Dropping AI event "${name}": it could not be serialized.`, e)
      return undefined
    }
    const { maxEventBytes, maxQueueSize, flushAt } = this._settings
    if (event.bytes > maxEventBytes) {
      this._logger.warn(`Dropping AI event "${name}": ${event.bytes} bytes is over the ${maxEventBytes}-byte limit.`)
      return undefined
    }

    const queue = [...this._queue(), event]
    let queuedBytes = queue.reduce((total, item) => total + item.bytes, 0)
    let droppedCount = 0
    while (queue.length > maxQueueSize || (queuedBytes > CAPTURE_AI_MAX_QUEUE_BYTES && queue.length > 1)) {
      queuedBytes -= queue.shift()!.bytes
      droppedCount++
    }
    if (droppedCount > 0) {
      this._logger.warn(`AI event queue is full; dropped the oldest ${droppedCount} event(s).`)
    }
    this._setQueue(queue)

    if (queue.length >= flushAt || queuedBytes >= CAPTURE_AI_BATCH_BYTE_TARGET) {
      this._flushInBackground()
    } else {
      this._scheduleFlush()
    }
    return event.uuid
  }

  /** Sends every queued AI event now, ignoring the resend wait. Never rejects. */
  flush(): Promise<void> {
    return this._queueDrain(false)
  }

  /** Flushes once more, then stops the lane's timers so nothing sends after shutdown. */
  async shutdown(): Promise<void> {
    try {
      await this.flush()
    } finally {
      this.stop()
    }
  }

  stop(): void {
    this._stopped = true
    this._clearFlushTimer()
    if (this._resendTimer) {
      clearTimeout(this._resendTimer)
      this._resendTimer = undefined
    }
    this._resendAt = 0
  }

  private _flushInBackground(): void {
    if (this._automaticFlushQueued) {
      return
    }
    this._automaticFlushQueued = true
    void this._queueDrain(true)
  }

  private _queueDrain(automatic: boolean): Promise<void> {
    const next = this._chain
      .then(() => {
        if (automatic) {
          this._automaticFlushQueued = false
        }
        return this._drain(automatic)
      })
      .catch((e) => this._logger.error('AI event flush failed:', e))
    this._chain = next
    return next
  }

  private async _drain(automatic: boolean): Promise<void> {
    this._clearFlushTimer()
    if (this._stopped || (automatic && Date.now() < this._resendAt)) {
      return
    }
    let remaining = this._queue().length
    // stop() can run while a request is in flight, when the shutdown deadline passes.
    while (remaining > 0 && !this._stopped) {
      const batch = this._takeBatch(this._queue())
      if (batch.length === 0) {
        return
      }
      let deferral: V1SendDeferral | undefined
      const kept = await this._sender().send(batch, {
        keepUnsent: true,
        onDeferred: (reason) => {
          deferral = reason
        },
      })
      const keptEvents = new Set(kept)
      const sentEvents = new Set(batch.filter((event) => !keptEvents.has(event)))
      if (sentEvents.size > 0) {
        this._setQueue(this._queue().filter((event) => !sentEvents.has(event)))
      }
      await this._storage.waitForPersist()

      if (!deferral) {
        this._resendCount = 0
        this._resendAt = 0
        remaining -= batch.length
        continue
      }
      if (deferral.tooLarge) {
        this._batchSize = Math.max(1, Math.floor(batch.length / 2))
        continue
      }
      this._scheduleResend(deferral.retryAfterMs)
      return
    }
  }

  private _takeBatch(queue: SerializedV1Event[]): SerializedV1Event[] {
    const batch: SerializedV1Event[] = []
    let bytes = 0
    for (const event of queue) {
      if (batch.length >= this._batchSize || (batch.length > 0 && bytes + event.bytes > CAPTURE_AI_BATCH_BYTE_TARGET)) {
        break
      }
      batch.push(event)
      bytes += event.bytes
    }
    return batch
  }

  private _scheduleFlush(): void {
    if (this._stopped || this._flushTimer || this._settings.flushIntervalMs <= 0) {
      return
    }
    this._flushTimer = safeSetTimeout(() => {
      this._flushTimer = undefined
      this._flushInBackground()
    }, this._settings.flushIntervalMs)
  }

  private _clearFlushTimer(): void {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer)
      this._flushTimer = undefined
    }
  }

  private _scheduleResend(retryAfterMs: number | undefined): void {
    if (this._stopped) {
      return
    }
    const jitter = 0.75 + 0.5 * Math.random()
    // Cap before jitter so waits at the ceiling stay spread out.
    const baseMs = Math.min(1000 * 2 ** Math.min(this._resendCount, 5), MAX_RESEND_WAIT_MS)
    const backoffMs = Math.min(baseMs * jitter, MAX_RESEND_WAIT_MS)
    const waitMs =
      retryAfterMs === undefined ? backoffMs : Math.max(backoffMs, Math.min(retryAfterMs, MAX_RESEND_WAIT_MS))
    this._resendCount++
    this._resendAt = Date.now() + waitMs
    if (this._resendTimer) {
      clearTimeout(this._resendTimer)
    }
    this._resendTimer = safeSetTimeout(() => {
      this._resendTimer = undefined
      // Timers can fire a little early, which would otherwise leave the hold in place with nothing rescheduled.
      this._resendAt = 0
      this._flushInBackground()
    }, waitMs)
  }

  private _queue(): SerializedV1Event[] {
    if (this._events) {
      return this._events
    }
    const stored = this._storage.getItem(PostHogPersistedProperty.AiQueue)
    const events = Array.isArray(stored) ? stored.filter(isPersistedEvent).map(this._fromPersisted) : []
    // Until storage has loaded, a read sees nothing yet; caching it would lose an earlier launch's events.
    if (this._storageLoaded) {
      this._events = events
    }
    return events
  }

  // Reads before storage has loaded aren't cached, so the same stored item must map to the same event each time.
  private _restored = new WeakMap<PersistedAiEvent, SerializedV1Event>()

  private _fromPersisted = (item: PersistedAiEvent): SerializedV1Event => {
    let event = this._restored.get(item)
    if (!event) {
      event = toPersisted(item)
      this._restored.set(item, event)
    }
    return event
  }

  private _setQueue(queue: SerializedV1Event[]): void {
    this._events = queue
    // Newest first, skipping an event that doesn't fit so it never costs the smaller ones before it their place.
    const persisted: PersistedAiEvent[] = []
    let bytes = 0
    for (let index = queue.length - 1; index >= 0; index--) {
      if (bytes + queue[index].bytes <= CAPTURE_AI_MAX_PERSISTED_BYTES) {
        persisted.push(toPersisted(queue[index]))
        bytes += queue[index].bytes
      }
    }
    if (persisted.length > 0) {
      this._storage.setItem(PostHogPersistedProperty.AiQueue, persisted.reverse())
    } else {
      this._storage.removeItem(PostHogPersistedProperty.AiQueue)
    }
  }
}

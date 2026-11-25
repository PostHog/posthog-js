import { PostHogPersistedProperty, safeSetTimeout, type Logger, type PostHogEventProperties } from '@posthog/core'
import {
  canonicalizeUuid,
  serializeV1Event,
  wireProblem,
  type CaptureDroppedEvent,
  type SerializedV1Event,
  type V1CaptureSender,
  type V1RequestIdentity,
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
  // The events the last request left to send again, which a resend of exactly those events sends as a retry of it.
  private _resend?: { events: SerializedV1Event[]; request: V1RequestIdentity }
  private _shutdownWait?: { timer: ReturnType<typeof setTimeout>; resolve: () => void }
  private _batchSize: number
  private _stopped = false
  // Once shutdown starts it sends every resend itself, so no timer may send on its own.
  private _shuttingDown = false
  private _events?: SerializedV1Event[]
  private _storageLoaded = false

  constructor(
    private readonly _storage: PostHogRNStorage,
    private readonly _settings: CaptureAiLaneSettings,
    private readonly _sender: () => V1CaptureSender,
    private readonly _logger: Logger,
    private readonly _onLocalDrops: (drops: CaptureDroppedEvent[]) => void
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
    const uuid = typeof message.uuid === 'string' ? canonicalizeUuid(message.uuid) : undefined
    const drop = (details: string): undefined => {
      this._onLocalDrops([{ uuid: uuid ?? String(message.uuid), details }])
      return undefined
    }
    const problem = wireProblem(message)
    if (problem) {
      this._logger.warn(`Dropping AI event "${name}": ${problem}.`)
      return drop('invalid event')
    }
    let event: SerializedV1Event
    try {
      event = serializeV1Event(uuid ? { ...message, uuid } : message)
    } catch (e) {
      this._logger.error(`Dropping AI event "${name}": it could not be serialized.`, e)
      return drop('unserializable event')
    }
    const { maxEventBytes, maxQueueSize, flushAt } = this._settings
    if (event.bytes > maxEventBytes) {
      this._logger.warn(`Dropping AI event "${name}": ${event.bytes} bytes is over the ${maxEventBytes}-byte limit.`)
      return drop('event too large')
    }
    if (event.bytes > CAPTURE_AI_MAX_PERSISTED_BYTES) {
      this._logger.warn(
        `AI event "${name}" is ${event.bytes} bytes, over the ${CAPTURE_AI_MAX_PERSISTED_BYTES}-byte on-device limit, so it is lost if the app is killed before it is sent.`
      )
    }

    const queue = [...this._queue(), event]
    let queuedBytes = queue.reduce((total, item) => total + item.bytes, 0)
    const evicted: CaptureDroppedEvent[] = []
    while (queue.length > maxQueueSize || (queuedBytes > CAPTURE_AI_MAX_QUEUE_BYTES && queue.length > 1)) {
      const oldest = queue.shift()!
      queuedBytes -= oldest.bytes
      evicted.push({ uuid: oldest.uuid, details: 'queue full' })
    }
    if (evicted.length > 0) {
      this._logger.warn(`AI event queue is full; dropped the oldest ${evicted.length} event(s).`)
    }
    this._setQueue(queue)
    if (evicted.length > 0) {
      this._onLocalDrops(evicted)
    }

    if (queue.length >= flushAt || queuedBytes >= CAPTURE_AI_BATCH_BYTE_TARGET) {
      this._flushInBackground()
    } else {
      this._scheduleFlush()
    }
    return event.uuid
  }

  /** Sends every queued AI event now, unless the endpoint asked to wait; then it resolves without sending. Never rejects. */
  flush(): Promise<void> {
    return this._queueDrain(false)
  }

  /**
   * Joins a flush already in flight, then sends what is left, waiting out each resend wait that ends within
   * `timeoutMs`. It stops once a flush sends nothing, then stops the lane's timers so nothing sends after shutdown.
   */
  async shutdown(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    this._shuttingDown = true
    this._clearFlushTimer()
    this._clearResendTimer()
    try {
      await this._chain
      while (!this._stopped && this._queue().length > 0 && Date.now() < deadline) {
        const holdMs = Math.max(0, this._resendAt - Date.now())
        if (holdMs > 0) {
          if (Date.now() + holdMs >= deadline) {
            return
          }
          await new Promise<void>((resolve) => {
            this._shutdownWait = { timer: safeSetTimeout(resolve, holdMs), resolve }
          })
          this._shutdownWait = undefined
          if (this._stopped) {
            return
          }
          this._resendAt = 0
          continue
        }
        const queued = this._queue().length
        await this.flush()
        if (this._queue().length >= queued) {
          return
        }
      }
    } finally {
      this.stop()
    }
  }

  stop(): void {
    this._stopped = true
    this._clearFlushTimer()
    this._clearResendTimer()
    this._resendAt = 0
    if (this._shutdownWait) {
      clearTimeout(this._shutdownWait.timer)
      this._shutdownWait.resolve()
      this._shutdownWait = undefined
    }
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
        return this._drain()
      })
      .catch((e) => this._logger.error('AI event flush failed:', e))
    this._chain = next
    return next
  }

  private async _drain(): Promise<void> {
    this._clearFlushTimer()
    if (this._stopped || Date.now() < this._resendAt) {
      return
    }
    let remaining = this._queue().length
    // stop() can run while a request is in flight, when the shutdown deadline passes.
    while (remaining > 0 && !this._stopped) {
      const queue = this._queue()
      const resend = this._resend
      this._resend = undefined
      // Eviction can break the match; then the events left go out in a new request.
      const exactResend =
        resend !== undefined &&
        queue.length >= resend.events.length &&
        resend.events.every((event, index) => queue[index] === event)
      const batch = exactResend ? resend.events : this._takeBatch(queue)
      if (batch.length === 0) {
        return
      }
      let deferral: V1SendDeferral | undefined
      const kept = await this._sender().send(batch, {
        keepUnsent: true,
        retryOf: exactResend ? resend.request : undefined,
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
        this._clearResendTimer()
        remaining -= batch.length
        continue
      }
      if (deferral.tooLarge) {
        this._batchSize = Math.max(1, Math.floor(batch.length / 2))
        continue
      }
      const keptInOrder = batch.filter((event) => keptEvents.has(event))
      if (keptInOrder.length > 0) {
        this._resend = { events: keptInOrder, request: deferral.request }
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
    if (this._stopped || this._shuttingDown || this._flushTimer || this._settings.flushIntervalMs <= 0) {
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

  private _clearResendTimer(): void {
    if (this._resendTimer) {
      clearTimeout(this._resendTimer)
      this._resendTimer = undefined
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
    this._clearResendTimer()
    if (this._shuttingDown) {
      return
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

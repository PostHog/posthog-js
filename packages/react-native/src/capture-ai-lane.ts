import { PostHogPersistedProperty, safeSetTimeout, type Logger, type PostHogEventProperties } from '@posthog/core'
import {
  canonicalizeUuid,
  serializeV1Event,
  utf8Length,
  wireProblem,
  type CaptureDroppedEvent,
  type SerializedV1Event,
  type V1CaptureSender,
  type V1RequestIdentity,
  type V1SendDeferral,
} from '@posthog/core/capture-v1'
import type { PostHogRNStorage } from './storage'
import type { PostHogCustomStorage } from './types'

/** Capture drops AI events whose properties are over 8 MiB; the whole-event measure allows 64 KiB for the rest. */
export const CAPTURE_AI_DEFAULT_MAX_EVENT_BYTES = 8 * 1024 * 1024 + 64 * 1024
export const CAPTURE_AI_DEFAULT_MAX_QUEUE_SIZE = 100
export const CAPTURE_AI_DEFAULT_TIMEOUT_MS = 60_000
const CAPTURE_AI_MAX_QUEUE_BYTES = 50 * 1024 * 1024
const CAPTURE_AI_BATCH_BYTE_TARGET = 5 * 1024 * 1024
const MAX_RESEND_WAIT_MS = 30_000

export interface CaptureAiLaneSettings {
  flushAt: number
  maxBatchSize: number
  flushIntervalMs: number
  maxQueueSize: number
  maxEventBytes: number
}

/** Where queued AI events are stored across launches: each event's JSON in its own slot of `storage`. */
export interface CaptureAiEventFiles {
  storage: PostHogCustomStorage
  key: (slot: number) => string
}

/**
 * A queued AI event's entry in the stored index; its JSON is in slot `slot`. It is written field by field
 * rather than as core's `SerializedV1Event`, so a change to that type can't silently drop events an
 * earlier version queued.
 */
interface StoredAiEvent {
  uuid: string
  bytes: number
  propertiesBytes: number
  slot: number
}

const isStoredEvent = (item: unknown): item is StoredAiEvent => {
  if (typeof item !== 'object' || item === null) {
    return false
  }
  const { uuid, bytes, propertiesBytes, slot } = item as StoredAiEvent
  return (
    typeof uuid === 'string' &&
    typeof bytes === 'number' &&
    typeof propertiesBytes === 'number' &&
    Number.isInteger(slot) &&
    slot >= 0
  )
}

/** A queued event. With slots, its `json` is let go once its slot is written, and read back when its batch is sent. */
type QueuedAiEvent = Omit<SerializedV1Event, 'json'> & { json?: string }

/**
 * The `captureAi()` delivery lane: its own durable queue, flush cycle, resend wait and sender, so a
 * slow or failing AI upload never holds back analytics events, and the reverse. Events are queued
 * already serialized, so each one is serialized once. With `files`, each event is written once to its
 * own slot and only a small index is rewritten on each change; only the index stays in memory, and a
 * batch's events are read from their slots when it is sent. Without `files`, the queue is kept in memory.
 */
export class CaptureAiLane {
  private _chain: Promise<void>
  private _automaticFlushQueued = false
  private _flushTimer?: ReturnType<typeof setTimeout>
  private _resendTimer?: ReturnType<typeof setTimeout>
  private _resendAt = 0
  private _resendCount = 0
  // The events the last request left to send again, which a resend of exactly those events sends as a retry of it.
  private _resend?: { events: QueuedAiEvent[]; request: V1RequestIdentity }
  private _shutdownWait?: { timer: ReturnType<typeof setTimeout>; resolve: () => void }
  private _batchSize: number
  private _stopped = false
  private _events: QueuedAiEvent[] = []
  private _loaded = false
  private readonly _loadPromise: Promise<void>
  private _slots = new Map<QueuedAiEvent, number>()
  // The last write to each slot, so writes to one slot land in order.
  private _slotWrites = new Map<number, Promise<boolean>>()
  // Content for a slot whose write hasn't started yet; a newer write replaces it, so an evicted event's JSON isn't kept.
  private _pendingSlotContent = new Map<number, string>()

  constructor(
    private readonly _storage: PostHogRNStorage,
    private readonly _files: CaptureAiEventFiles | undefined,
    private readonly _settings: CaptureAiLaneSettings,
    private readonly _sender: () => V1CaptureSender,
    private readonly _logger: Logger,
    private readonly _onLocalDrops: (drops: CaptureDroppedEvent[]) => void
  ) {
    this._batchSize = _settings.maxBatchSize
    // Every drain runs after the load, so a flush before storage has loaded still sends an earlier launch's events.
    this._loadPromise = this._load().catch((e) => this._logger.error('Loading stored AI events failed:', e))
    this._chain = this._loadPromise
  }

  /** Resolves once storage has loaded and the stored index and every started event write have landed. Never rejects. */
  async waitForPersist(): Promise<void> {
    // Events captured while storage loads get their slots only once it has.
    if (!this._loaded) {
      await this._loadPromise
    }
    await Promise.all([this._storage.waitForPersist(), ...this._slotWrites.values()])
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
    const { maxEventBytes, flushAt } = this._settings
    if (event.bytes > maxEventBytes) {
      this._logger.warn(`Dropping AI event "${name}": ${event.bytes} bytes is over the ${maxEventBytes}-byte limit.`)
      return drop('event too large')
    }

    const { queue, queuedBytes } = this._setTrimmedQueue([...this._events, event])
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
   * Flushes once more, waiting out a resend wait that ends within `timeoutMs`, then stops the lane's
   * timers so nothing sends after shutdown.
   */
  async shutdown(timeoutMs: number): Promise<void> {
    try {
      const holdMs = Math.max(0, this._resendAt - Date.now())
      if (holdMs > 0 && this._events.length > 0) {
        if (holdMs >= timeoutMs) {
          return
        }
        await new Promise<void>((resolve) => {
          this._shutdownWait = { timer: safeSetTimeout(resolve, holdMs), resolve }
        })
        this._shutdownWait = undefined
        this._resendAt = 0
      }
      await this.flush()
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
    let remaining = this._events.length
    // stop() can run while a request is in flight, when the shutdown deadline passes.
    while (remaining > 0 && !this._stopped) {
      const resend = this._resend
      this._resend = undefined
      // Eviction can break the match; then the events left go out in a new request.
      const exactResend =
        resend !== undefined &&
        this._events.length >= resend.events.length &&
        resend.events.every((item, index) => this._events[index] === item)
      const queued = exactResend ? resend.events : this._takeBatch(this._events)
      if (queued.length === 0) {
        return
      }
      const batch = await this._readBatch(queued)
      remaining -= queued.length - batch.size
      if (batch.size === 0) {
        continue
      }
      let deferral: V1SendDeferral | undefined
      const kept = await this._sender().send([...batch.keys()], {
        keepUnsent: true,
        // A batch missing an unreadable event is no longer the same request.
        retryOf: exactResend && batch.size === queued.length ? resend.request : undefined,
        onDeferred: (reason) => {
          deferral = reason
        },
      })
      const keptEvents = new Set(kept)
      const sentEvents = new Set([...batch].filter(([event]) => !keptEvents.has(event)).map(([, item]) => item))
      if (sentEvents.size > 0) {
        this._setQueue(this._events.filter((event) => !sentEvents.has(event)))
      }
      await this.waitForPersist()

      if (!deferral) {
        this._resendCount = 0
        this._resendAt = 0
        this._clearResendTimer()
        remaining -= batch.size
        continue
      }
      if (deferral.tooLarge) {
        this._batchSize = Math.max(1, Math.floor(batch.size / 2))
        continue
      }
      const keptInOrder = [...batch].filter(([event]) => keptEvents.has(event)).map(([, item]) => item)
      if (keptInOrder.length > 0) {
        this._resend = { events: keptInOrder, request: deferral.request }
      }
      this._scheduleResend(deferral.retryAfterMs)
      return
    }
  }

  private _takeBatch(queue: QueuedAiEvent[]): QueuedAiEvent[] {
    const batch: QueuedAiEvent[] = []
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

  /** The batch's events as sent, each with its queued event; events whose slot can't be read are dropped from the queue. */
  private async _readBatch(queued: QueuedAiEvent[]): Promise<Map<SerializedV1Event, QueuedAiEvent>> {
    const jsons = await Promise.all(queued.map((item) => item.json ?? this._readSlot(item)))
    const batch = new Map<SerializedV1Event, QueuedAiEvent>()
    const unreadable = new Set<QueuedAiEvent>()
    queued.forEach((item, i) => {
      const json = jsons[i]
      if (json === undefined) {
        unreadable.add(item)
      } else {
        batch.set({ uuid: item.uuid, json, bytes: item.bytes, propertiesBytes: item.propertiesBytes }, item)
      }
    })
    if (unreadable.size > 0) {
      this._logger.warn(`Dropping ${unreadable.size} stored AI event(s) that could not be read back.`)
      this._setQueue(this._events.filter((item) => !unreadable.has(item)))
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

  private async _load(): Promise<void> {
    const restored: QueuedAiEvent[] = []
    try {
      if (this._files) {
        await this._storage.preloadPromise?.catch(() => {})
        // Stopped before storage loaded: leave the stored queue as it is for a later launch.
        if (this._stopped) {
          return
        }
        const stored = this._storage.getItem(PostHogPersistedProperty.AiQueue)
        const entries = Array.isArray(stored) ? stored.filter(isStoredEvent) : []
        for (const { uuid, bytes, propertiesBytes, slot } of entries) {
          const item: QueuedAiEvent = { uuid, bytes, propertiesBytes }
          this._slots.set(item, slot)
          restored.push(item)
        }
      }
    } finally {
      this._loaded = true
      // Events captured while storage loaded go after the earlier launch's, and get their slots now.
      if (!this._stopped && (restored.length > 0 || this._events.length > 0)) {
        this._events = [...restored, ...this._events]
        this._setTrimmedQueue([...this._events])
      }
      if (this._events.length > 0) {
        this._scheduleFlush()
      }
    }
  }

  /**
   * The event's JSON from its slot, or undefined when the slot now holds another event or was cut off
   * mid-write. A slot starts with its event's uuid, and the JSON must be the size the index recorded.
   */
  private async _readSlot(item: QueuedAiEvent): Promise<string | undefined> {
    const slot = this._slots.get(item)
    if (!this._files || slot === undefined) {
      return undefined
    }
    let content: string | null = null
    try {
      content = await this._files.storage.getItem(this._files.key(slot))
    } catch (e) {
      this._logger.error('Reading a stored AI event failed:', e)
    }
    const prefix = `${item.uuid}\n`
    if (typeof content !== 'string' || !content.startsWith(prefix)) {
      return undefined
    }
    const json = content.slice(prefix.length)
    return utf8Length(json) === item.bytes ? json : undefined
  }

  /** Drops the oldest events beyond the queue's count and byte caps, then stores what is left. */
  private _setTrimmedQueue(queue: QueuedAiEvent[]): { queue: QueuedAiEvent[]; queuedBytes: number } {
    let queuedBytes = queue.reduce((total, item) => total + item.bytes, 0)
    const evicted: CaptureDroppedEvent[] = []
    while (
      queue.length > this._settings.maxQueueSize ||
      (queuedBytes > CAPTURE_AI_MAX_QUEUE_BYTES && queue.length > 1)
    ) {
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
    return { queue, queuedBytes }
  }

  private _setQueue(queue: QueuedAiEvent[]): void {
    const previous = this._events
    this._events = queue
    // Until storage has loaded, slots in use are unknown; _load stores these events once it has.
    if (!this._files || !this._loaded) {
      return
    }
    const kept = new Set(queue)
    const freed = new Set<number>()
    for (const event of previous) {
      const slot = this._slots.get(event)
      if (slot !== undefined && !kept.has(event)) {
        this._slots.delete(event)
        freed.add(slot)
      }
    }
    const used = new Set(this._slots.values())
    let free = 0
    for (const event of queue) {
      if (!this._slots.has(event)) {
        while (used.has(free)) {
          free++
        }
        used.add(free)
        freed.delete(free)
        this._slots.set(event, free)
        // Only events captured this launch are without a slot, and they still hold their JSON.
        void this._writeSlot(free, `${event.uuid}\n${event.json!}`).then((stored) => {
          if (stored) {
            event.json = undefined
          }
        })
      }
    }
    // A freed slot that a new event took is overwritten by it, so only the rest are cleared.
    for (const slot of freed) {
      void this._writeSlot(slot, '')
    }
    if (queue.length > 0) {
      const index: StoredAiEvent[] = queue.map(({ uuid, bytes, propertiesBytes }, i) => ({
        uuid,
        bytes,
        propertiesBytes,
        slot: this._slots.get(queue[i])!,
      }))
      this._storage.setItem(PostHogPersistedProperty.AiQueue, index)
    } else {
      this._storage.removeItem(PostHogPersistedProperty.AiQueue)
    }
  }

  /**
   * Resolves true once `content`, or newer content for the slot, is in the slot, or false when the write
   * failed. Writes queued behind a running one are merged, so only the newest content is written.
   */
  private _writeSlot(slot: number, content: string): Promise<boolean> {
    const files = this._files!
    const queued = this._pendingSlotContent.has(slot)
    this._pendingSlotContent.set(slot, content)
    if (queued) {
      return this._slotWrites.get(slot)!
    }
    const write = (this._slotWrites.get(slot) ?? Promise.resolve(true))
      .then(() => {
        const latest = this._pendingSlotContent.get(slot)!
        this._pendingSlotContent.delete(slot)
        return files.storage.setItem(files.key(slot), latest)
      })
      .then(
        () => true,
        (e) => {
          this._logger.error('Storing an AI event failed:', e)
          return false
        }
      )
    this._slotWrites.set(slot, write)
    void write.then(() => {
      if (this._slotWrites.get(slot) === write) {
        this._slotWrites.delete(slot)
      }
    })
    return write
  }
}

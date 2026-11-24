import { PostHogPersistedProperty, safeSetTimeout, type Logger, type PostHogEventProperties } from '@posthog/core'
import {
  canonicalizeUuid,
  serializeV1Event,
  wireProblem,
  type CaptureDroppedEvent,
  type SerializedV1Event,
  type V1CaptureSender,
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

// A slot starts with the uuid of the event it holds, so an index entry never reads a slot that was reused.
const slotContent = (event: SerializedV1Event): string => `${event.uuid}\n${event.json}`

/**
 * The `captureAi()` delivery lane: its own durable queue, flush cycle, resend wait and sender, so a
 * slow or failing AI upload never holds back analytics events, and the reverse. Events are queued
 * already serialized, so each one is serialized once. With `files`, each event is written once to its
 * own slot and only a small index is rewritten on each change; without it, the queue is kept in memory.
 */
export class CaptureAiLane {
  private _chain: Promise<void>
  private _automaticFlushQueued = false
  private _flushTimer?: ReturnType<typeof setTimeout>
  private _resendTimer?: ReturnType<typeof setTimeout>
  private _resendAt = 0
  private _resendCount = 0
  private _batchSize: number
  private _stopped = false
  private _events: SerializedV1Event[] = []
  private _loaded = false
  private _slots = new Map<SerializedV1Event, number>()
  // The last write to each slot, so writes to one slot land in order.
  private _slotWrites = new Map<number, Promise<void>>()

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
    this._chain = this._load().catch((e) => this._logger.error('Loading stored AI events failed:', e))
  }

  /** Resolves once the stored index and every started event write have landed. Never rejects. */
  async waitForPersist(): Promise<void> {
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
    let remaining = this._events.length
    // stop() can run while a request is in flight, when the shutdown deadline passes.
    while (remaining > 0 && !this._stopped) {
      const batch = this._takeBatch(this._events)
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
        this._setQueue(this._events.filter((event) => !sentEvents.has(event)))
      }
      await this.waitForPersist()

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

  private async _load(): Promise<void> {
    let restored: SerializedV1Event[] = []
    try {
      if (this._files) {
        await this._storage.preloadPromise?.catch(() => {})
        const stored = this._storage.getItem(PostHogPersistedProperty.AiQueue)
        const entries = Array.isArray(stored) ? stored.filter(isStoredEvent) : []
        const events = await Promise.all(entries.map((entry) => this._readSlot(entry)))
        restored = events.filter((event): event is SerializedV1Event => event !== undefined)
      }
    } finally {
      this._loaded = true
      // Events captured while storage loaded go after the earlier launch's, and get their slots now.
      if (restored.length > 0 || this._events.length > 0) {
        this._events = [...restored, ...this._events]
        this._setTrimmedQueue([...this._events])
      }
      if (this._events.length > 0) {
        this._scheduleFlush()
      }
    }
  }

  private async _readSlot(entry: StoredAiEvent): Promise<SerializedV1Event | undefined> {
    let content: string | null = null
    try {
      content = await this._files!.storage.getItem(this._files!.key(entry.slot))
    } catch (e) {
      this._logger.error('Reading a stored AI event failed:', e)
    }
    const prefix = `${entry.uuid}\n`
    if (typeof content !== 'string' || !content.startsWith(prefix)) {
      return undefined
    }
    const event: SerializedV1Event = {
      uuid: entry.uuid,
      json: content.slice(prefix.length),
      bytes: entry.bytes,
      propertiesBytes: entry.propertiesBytes,
    }
    this._slots.set(event, entry.slot)
    return event
  }

  /** Drops the oldest events beyond the queue's count and byte caps, then stores what is left. */
  private _setTrimmedQueue(queue: SerializedV1Event[]): { queue: SerializedV1Event[]; queuedBytes: number } {
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

  private _setQueue(queue: SerializedV1Event[]): void {
    const previous = this._events
    this._events = queue
    // Until storage has loaded, slots in use are unknown; _load stores these events once it has.
    if (!this._files || !this._loaded) {
      return
    }
    const kept = new Set(queue)
    for (const event of previous) {
      const slot = this._slots.get(event)
      if (slot !== undefined && !kept.has(event)) {
        this._slots.delete(event)
        this._writeSlot(slot, '')
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
        this._slots.set(event, free)
        this._writeSlot(free, slotContent(event))
      }
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

  private _writeSlot(slot: number, content: string): void {
    const files = this._files!
    const write = (this._slotWrites.get(slot) ?? Promise.resolve())
      .then(() => files.storage.setItem(files.key(slot), content))
      .catch((e) => this._logger.error('Storing an AI event failed:', e))
    this._slotWrites.set(slot, write)
    void write.then(() => {
      if (this._slotWrites.get(slot) === write) {
        this._slotWrites.delete(slot)
      }
    })
  }
}

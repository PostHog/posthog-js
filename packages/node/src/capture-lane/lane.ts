import { type Logger, type PostHogEventProperties, safeSetTimeout } from '@posthog/core'

import { CaptureError, CaptureLossTally, type CaptureDroppedEvent, describeCaptureLoss } from '../capture-v1/errors'
import type { V1SendOptions } from '../capture-v1/sender'
import { type SerializedV1Event, serializeV1Event } from '../capture-v1/serialize'
import type { CaptureEndpoint } from '../capture-v1/types'

/** Upper bound on the uuids one local-drop report lists; the message still carries the full count. */
const MAX_REPORTED_LOCAL_DROPS = 100

/** What a lane needs from its sender. `V1CaptureSender` implements it. */
export interface CaptureLaneSender {
  send<T extends SerializedV1Event>(events: T[], options?: V1SendOptions): Promise<T[]>
}

export interface CaptureLaneConfig {
  endpoint: CaptureEndpoint
  /** Queue length that starts a flush. */
  flushAt: number
  /** Delay before a flush of queued events; 0 turns the timer off. */
  flushIntervalMs: number
  maxBatchSize: number
  /** When the queue holds this many events, a new event drops the oldest. */
  maxQueueSize: number
  /** A batch stops before an event that would take its serialized bytes past this. */
  targetBatchBytes: number
  /** Events larger than this are dropped before sending. */
  maxEventBytes: number
  /** Whether `maxEventBytes` applies to the whole serialized event or to its `properties` only. */
  maxEventBytesOf: 'event' | 'properties'
}

export interface CaptureLaneHooks {
  sender: CaptureLaneSender
  /**
   * Events this lane dropped without sending, at most one report per flush cycle. `summary` is
   * one line with counts and causes only, for when nothing listens.
   */
  onLocalDrops: (errors: CaptureError[], summary: string) => void
  /** Failures the sender did not handle itself. */
  onError: (error: unknown) => void
  /** The messages one flush cycle sent. */
  onFlush: (messages: PostHogEventProperties[]) => void
  /** Each flush the lane starts on its own, from its timer or `flushAt`. */
  onBackgroundFlush?: (flush: Promise<void>) => void
  logger: Logger
  now?: () => number
}

interface QueuedEvent extends SerializedV1Event {
  message: PostHogEventProperties
}

interface LocalDropTally {
  queueFull: number
  tooLarge: number
  sample: CaptureDroppedEvent[]
}

const emptyTally = (): LocalDropTally => ({ queueFull: 0, tooLarge: 0, sample: [] })

/**
 * One capture endpoint's in-memory queue, flush timer, `flushAt` trigger, batching and
 * in-flight send. Lanes share nothing, so a slow or failing lane never delays, drops
 * or resends another lane's events.
 *
 * Every event is serialized once, on enqueue. Batches are cut by count and by
 * serialized bytes, keeping queue order. An event whose last attempt got no HTTP
 * response goes back to the head of the queue for the next flush; every other
 * failure is final and reported by the sender.
 */
export class CaptureLane {
  private readonly config: CaptureLaneConfig
  private readonly hooks: CaptureLaneHooks
  private readonly now: () => number
  private queue: QueuedEvent[] = []
  private flushTimer?: ReturnType<typeof safeSetTimeout>
  private activeFlush: Promise<void> | null = null
  // A flush requested while another is in flight; later requests share it.
  private queuedFlush: Promise<void> | null = null
  private abortController = new AbortController()
  private abortTimer?: ReturnType<typeof safeSetTimeout>
  private localDrops = emptyTally()
  // Events that reached a final outcome, so a drain can tell whether a cycle moved anything.
  private settledCount = 0

  constructor(config: CaptureLaneConfig, hooks: CaptureLaneHooks) {
    this.config = config
    this.hooks = hooks
    this.now = hooks.now ?? Date.now
  }

  get length(): number {
    return this.queue.length
  }

  enqueue(message: PostHogEventProperties): void {
    const event: QueuedEvent = { ...serializeV1Event(message), message }
    if (this.isTooLarge(event)) {
      this.recordLocalDrop(event, 'tooLarge')
      // Nothing may follow to flush, and the flush cycle is what reports the drop.
      this.armFlushTimer()
      return
    }
    if (this.queue.length >= this.config.maxQueueSize) {
      this.recordLocalDrop(this.queue.shift()!, 'queueFull')
    }
    this.queue.push(event)

    if (this.queue.length >= this.config.flushAt) {
      this.flushInBackground()
    } else {
      this.armFlushTimer()
    }
  }

  /** Sends one event now, without queueing. Delivery failures are reported, not thrown. */
  async sendImmediate(message: PostHogEventProperties): Promise<void> {
    const event = serializeV1Event(message)
    if (this.isTooLarge(event)) {
      const tally = emptyTally()
      this.addToTally(tally, event, 'tooLarge')
      this.reportTally(tally)
      return
    }
    await this.hooks.sender.send([event], { signal: this.abortController.signal })
  }

  /** Sends everything queued when the returned flush starts. Never rejects. */
  flush(): Promise<void> {
    if (this.queuedFlush) {
      return this.queuedFlush
    }
    if (!this.activeFlush) {
      return this.startFlush()
    }
    const queued = this.activeFlush.then(() => {
      this.queuedFlush = null
      return this.startFlush()
    })
    this.queuedFlush = queued
    return queued
  }

  /**
   * Flushes until the queue is empty, a cycle settles nothing (every send was requeued),
   * or `deadlineMs` passes. At the deadline, in-flight and later sends are aborted.
   */
  async drain(deadlineMs: number): Promise<void> {
    this.abortAt(deadlineMs)
    let settledBefore: number
    do {
      settledBefore = this.settledCount
      await this.flush()
    } while (this.queue.length > 0 && this.settledCount !== settledBefore && !this.abortController.signal.aborted)
  }

  /**
   * Ends a shutdown: reports and discards what is still queued, and re-arms the lane so
   * calls made after shutdown still send.
   */
  finishShutdown(): void {
    clearTimeout(this.abortTimer)
    this.abortTimer = undefined
    this.clearFlushTimer()
    this.reportLocalDrops(this.queue.splice(0))
    if (this.abortController.signal.aborted) {
      this.abortController = new AbortController()
    }
  }

  private startFlush(): Promise<void> {
    const flush = this.runFlushCycle().finally(() => {
      if (this.activeFlush === flush) {
        this.activeFlush = null
      }
    })
    this.activeFlush = flush
    return flush
  }

  private flushInBackground(): void {
    if (this.queuedFlush) {
      return
    }
    const flush = this.flush()
    this.safely(() => this.hooks.onBackgroundFlush?.(flush))
  }

  private async runFlushCycle(): Promise<void> {
    this.clearFlushTimer()
    // Lets events enqueued in the same burst join this cycle's first batch.
    await Promise.resolve()
    // Events enqueued during this cycle wait for the next one, so a steady stream cannot hold a flush open.
    const budget = this.queue.length
    const sent: PostHogEventProperties[] = []
    let taken = 0
    try {
      while (taken < budget && this.queue.length > 0) {
        const batch = this.takeBatch()
        taken += batch.length
        let unsent: QueuedEvent[]
        try {
          unsent = await this.hooks.sender.send(batch, { signal: this.abortController.signal, keepUnsent: true })
        } catch (error) {
          // An unexpected sender failure is final for the batch, like any other non-network failure.
          this.settledCount += batch.length
          this.safely(() => this.hooks.onError(error))
          continue
        }
        this.settledCount += batch.length - unsent.length
        const requeued = new Set(unsent)
        for (const event of batch) {
          if (!requeued.has(event)) {
            sent.push(event.message)
          }
        }
        if (unsent.length > 0) {
          this.requeue(unsent)
          // The network is likely down, so the rest of the queue waits for the next flush too.
          break
        }
      }
    } catch (error) {
      this.safely(() => this.hooks.onError(error))
    } finally {
      if (sent.length > 0) {
        this.safely(() => this.hooks.onFlush(sent))
      }
      this.reportLocalDrops()
      if (this.queue.length > 0) {
        this.armFlushTimer()
      }
    }
  }

  private takeBatch(): QueuedEvent[] {
    let count = 0
    let bytes = 0
    while (count < this.queue.length && count < this.config.maxBatchSize) {
      const next = this.queue[count]
      // Check before appending: the event that would overflow starts the next batch, and an oversized one ships alone.
      if (count > 0 && bytes + next.bytes > this.config.targetBatchBytes) {
        break
      }
      bytes += next.bytes
      count++
    }
    return this.queue.splice(0, count)
  }

  private requeue(events: QueuedEvent[]): void {
    this.queue.unshift(...events)
    while (this.queue.length > this.config.maxQueueSize) {
      this.recordLocalDrop(this.queue.shift()!, 'queueFull')
    }
    this.hooks.logger.debug(
      `Kept ${events.length} event(s) for ${this.config.endpoint} after a network failure; the next flush sends them`
    )
  }

  private isTooLarge(event: SerializedV1Event): boolean {
    const bytes = this.config.maxEventBytesOf === 'properties' ? event.propertiesBytes : event.bytes
    return bytes > this.config.maxEventBytes
  }

  private recordLocalDrop(event: SerializedV1Event, reason: 'queueFull' | 'tooLarge'): void {
    this.addToTally(this.localDrops, event, reason)
  }

  private addToTally(tally: LocalDropTally, event: SerializedV1Event, reason: 'queueFull' | 'tooLarge'): void {
    tally[reason]++
    if (tally.sample.length < MAX_REPORTED_LOCAL_DROPS) {
      tally.sample.push({ uuid: event.uuid, details: reason === 'queueFull' ? 'queue full' : 'event too large' })
    }
  }

  private reportLocalDrops(leftovers: SerializedV1Event[] = []): void {
    const tally = this.localDrops
    this.localDrops = emptyTally()
    this.reportTally(tally, leftovers)
  }

  /** Reports `tally` and the events still queued at the end of a shutdown together, in one report. */
  private reportTally(tally: LocalDropTally, leftovers: SerializedV1Event[] = []): void {
    const errors: CaptureError[] = []
    const loss = new CaptureLossTally()
    const { endpoint } = this.config
    if (leftovers.length > 0) {
      const error = new CaptureError({
        endpoint,
        requestId: '',
        drops: [],
        retryExhausted: leftovers.map((event) => event.uuid),
      })
      error.message = `${leftovers.length} event(s) for ${endpoint} were still queued when shutdown ended and were not sent`
      errors.push(error)
      loss.add('still queued when shutdown ended', leftovers.length)
    }
    const total = tally.queueFull + tally.tooLarge
    if (total > 0) {
      const { maxQueueSize, maxEventBytes, maxEventBytesOf } = this.config
      const reasons: string[] = []
      if (tally.queueFull > 0) {
        reasons.push(`${tally.queueFull} because the queue was full (${maxQueueSize} events)`)
      }
      if (tally.tooLarge > 0) {
        const measured = maxEventBytesOf === 'properties' ? 'properties larger' : 'larger'
        reasons.push(`${tally.tooLarge} with ${measured} than ${maxEventBytes} bytes`)
      }
      const error = new CaptureError({ endpoint, requestId: '', drops: tally.sample, retryExhausted: [] })
      error.message = `Dropped ${total} event(s) for ${endpoint} before sending: ${reasons.join(', ')}`
      errors.push(error)
      loss.add(`dropped because the queue was full (${maxQueueSize} events)`, tally.queueFull)
      const measured = maxEventBytesOf === 'properties' ? 'their properties were' : 'they were'
      loss.add(`dropped because ${measured} larger than ${maxEventBytes} bytes`, tally.tooLarge)
    }
    if (errors.length > 0) {
      this.safely(() => this.hooks.onLocalDrops(errors, describeCaptureLoss(endpoint, loss)))
    }
  }

  private armFlushTimer(): void {
    if (this.flushTimer || !this.config.flushIntervalMs) {
      return
    }
    this.flushTimer = safeSetTimeout(() => {
      this.flushTimer = undefined
      this.flushInBackground()
    }, this.config.flushIntervalMs)
  }

  private clearFlushTimer(): void {
    clearTimeout(this.flushTimer)
    this.flushTimer = undefined
  }

  private abortAt(deadlineMs: number): void {
    clearTimeout(this.abortTimer)
    const abort = (): void => this.abortController.abort(new Error('PostHog shutdown deadline reached'))
    const delayMs = deadlineMs - this.now()
    if (delayMs <= 0) {
      abort()
      return
    }
    this.abortTimer = safeSetTimeout(abort, delayMs)
  }

  // Hooks run user listeners, which must not break the lane's own bookkeeping.
  private safely(fn: () => void): void {
    try {
      fn()
    } catch (error) {
      this.hooks.logger.error('Capture lane hook failed:', error)
    }
  }
}

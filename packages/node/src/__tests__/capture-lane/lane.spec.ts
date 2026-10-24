import type { Logger, PostHogEventProperties } from '@posthog/core'

import { CaptureLane, type CaptureLaneConfig } from '@/capture-lane/lane'
import { AI_MAX_PROPERTIES_BYTES } from '@/capture-lane/limits'
import { CaptureError } from '@/capture-v1/errors'
import type { V1SendOptions } from '@/capture-v1/sender'
import { type SerializedV1Event, serializeV1Event } from '@/capture-v1/serialize'

type SendBehavior = (events: SerializedV1Event[], options: V1SendOptions) => Promise<SerializedV1Event[]>

const accept: SendBehavior = () => Promise.resolve([])
const keepAll: SendBehavior = (events) => Promise.resolve(events)

function msg(id: string | number, properties: PostHogEventProperties = {}): PostHogEventProperties {
  return { event: 'e', distinct_id: 'd', uuid: `u${id}`, timestamp: '2024-01-01T00:00:00.000Z', properties }
}

/** A message whose serialized `properties` object is exactly `bytes` long. */
function msgWithPropertiesBytes(id: string, bytes: number): PostHogEventProperties {
  const overhead = serializeV1Event(msg(id, { pad: '' })).propertiesBytes
  return msg(id, { pad: 'x'.repeat(bytes - overhead) })
}

function makeLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
    createLogger: () => logger,
  }
  return logger
}

function makeLane(config: Partial<CaptureLaneConfig> = {}, behavior: SendBehavior = accept) {
  const batches: string[][] = []
  const flushes: string[][] = []
  const localDrops: CaptureError[] = []
  // One entry per report: a report can carry several errors but has one summary line.
  const summaries: string[] = []
  const errors: unknown[] = []
  const backgroundFlushes: Promise<void>[] = []
  let currentBehavior = behavior
  const send = vi.fn((events: SerializedV1Event[], options: V1SendOptions = {}) => {
    batches.push(events.map((event) => event.uuid))
    return currentBehavior(events, options)
  })
  const lane = new CaptureLane(
    {
      endpoint: '/i/v1/analytics/events',
      flushAt: 100,
      flushIntervalMs: 0,
      maxBatchSize: 100,
      maxQueueSize: 1000,
      targetBatchBytes: 1024 * 1024,
      maxEventBytes: 1024 * 1024,
      maxEventBytesOf: 'event',
      ...config,
    },
    {
      sender: { send: send as any },
      onLocalDrops: (reported, summary) => {
        localDrops.push(...reported)
        summaries.push(summary)
      },
      onError: (error) => errors.push(error),
      onFlush: (messages) => flushes.push(messages.map((message) => String(message.uuid))),
      onBackgroundFlush: (flush) => backgroundFlushes.push(flush),
      logger: makeLogger(),
    }
  )
  const setBehavior = (next: SendBehavior): void => {
    currentBehavior = next
  }
  return { lane, send, batches, flushes, localDrops, summaries, errors, backgroundFlushes, setBehavior }
}

const ids = (count: number, from = 1): string[] => Array.from({ length: count }, (_, i) => `u${from + i}`)

/** A flush cycle starts its first send a microtask after it is requested. */
const settle = (): Promise<void> => vi.advanceTimersByTimeAsync(0)

describe('CaptureLane', () => {
  describe('batching', () => {
    it('cuts batches at maxBatchSize and keeps queue order', async () => {
      const { lane, batches } = makeLane({ maxBatchSize: 3 })
      for (let i = 1; i <= 7; i++) {
        lane.enqueue(msg(i))
      }

      await lane.flush()

      expect(batches).toEqual([ids(3), ids(3, 4), ids(1, 7)])
    })

    it('starts a new batch with the event that would pass the byte target', async () => {
      const eventBytes = serializeV1Event(msg(1)).bytes
      // Room for two events, not three.
      const { lane, batches } = makeLane({ targetBatchBytes: eventBytes * 3 - 1 })
      for (let i = 1; i <= 5; i++) {
        lane.enqueue(msg(i))
      }

      await lane.flush()

      expect(batches).toEqual([ids(2), ids(2, 3), ids(1, 5)])
    })

    it('fills a batch to exactly the byte target', async () => {
      const eventBytes = serializeV1Event(msg(1)).bytes
      const { lane, batches } = makeLane({ targetBatchBytes: eventBytes * 2 })
      for (let i = 1; i <= 4; i++) {
        lane.enqueue(msg(i))
      }

      await lane.flush()

      expect(batches).toEqual([ids(2), ids(2, 3)])
    })

    it('ships an event larger than the byte target on its own', async () => {
      const { lane, batches } = makeLane({ targetBatchBytes: 500 })
      lane.enqueue(msg(1))
      lane.enqueue(msg(2, { pad: 'x'.repeat(600) }))
      lane.enqueue(msg(3))
      lane.enqueue(msg(4))

      await lane.flush()

      expect(batches).toEqual([['u1'], ['u2'], ['u3', 'u4']])
    })
  })

  describe('per-event size limit', () => {
    it('accepts AI properties of exactly the limit and drops one byte more, measuring properties only', async () => {
      const { lane, batches, localDrops } = makeLane({
        endpoint: '/i/v1/ai/events',
        maxEventBytes: AI_MAX_PROPERTIES_BYTES,
        maxEventBytesOf: 'properties',
        targetBatchBytes: 5 * 1024 * 1024,
      })
      const atLimit = msgWithPropertiesBytes('at-limit', AI_MAX_PROPERTIES_BYTES)
      const overLimit = msgWithPropertiesBytes('over-limit', AI_MAX_PROPERTIES_BYTES + 1)
      // The whole event is larger than the limit, which must not matter.
      expect(serializeV1Event(atLimit).bytes).toBeGreaterThan(AI_MAX_PROPERTIES_BYTES)

      lane.enqueue(atLimit)
      lane.enqueue(overLimit)
      await lane.flush()

      expect(batches).toEqual([['uat-limit']])
      expect(localDrops).toHaveLength(1)
      expect(localDrops[0]).toBeInstanceOf(CaptureError)
      expect(localDrops[0]).toMatchObject({
        endpoint: '/i/v1/ai/events',
        drops: [{ uuid: 'uover-limit', details: 'event too large' }],
        message: `Dropped 1 event(s) for /i/v1/ai/events before sending: 1 with properties larger than ${AI_MAX_PROPERTIES_BYTES} bytes`,
      })
    })

    it('measures the whole serialized event when configured to', async () => {
      const limit = serializeV1Event(msg('fits', { pad: 'x'.repeat(100) })).bytes
      const { lane, batches, localDrops } = makeLane({ maxEventBytes: limit, maxEventBytesOf: 'event' })

      lane.enqueue(msg('fits', { pad: 'x'.repeat(100) }))
      lane.enqueue(msg('over', { pad: 'x'.repeat(101) }))
      await lane.flush()

      expect(batches).toEqual([['ufits']])
      expect(localDrops.map((error) => error.drops)).toEqual([[{ uuid: 'uover', details: 'event too large' }]])
    })

    it('drops an oversized immediate event and reports it without sending', async () => {
      const { lane, send, localDrops } = makeLane({ maxEventBytes: 100 })

      await lane.sendImmediate(msg(1, { pad: 'x'.repeat(200) }))

      expect(send).not.toHaveBeenCalled()
      expect(localDrops).toHaveLength(1)
      expect(localDrops[0].drops).toEqual([{ uuid: 'u1', details: 'event too large' }])
    })

    it('sends an immediate event straight through the sender without queueing it', async () => {
      const { lane, send, batches } = makeLane()

      await lane.sendImmediate(msg(1))

      expect(batches).toEqual([['u1']])
      expect(send.mock.calls[0][1]).toEqual({ signal: expect.any(AbortSignal) })
      expect(lane.length).toBe(0)
    })
  })

  describe('queue cap', () => {
    it('drops the oldest events and reports them once per flush cycle', async () => {
      const { lane, batches, localDrops } = makeLane({ maxQueueSize: 3 })
      for (let i = 1; i <= 6; i++) {
        lane.enqueue(msg(i))
      }

      await lane.flush()

      expect(batches).toEqual([['u4', 'u5', 'u6']])
      expect(localDrops).toHaveLength(1)
      expect(localDrops[0].drops.map((drop) => drop.uuid)).toEqual(['u1', 'u2', 'u3'])
      expect(localDrops[0].message).toBe(
        'Dropped 3 event(s) for /i/v1/analytics/events before sending: 3 because the queue was full (3 events)'
      )

      await lane.flush()
      expect(localDrops).toHaveLength(1)
    })

    it('lists at most 100 uuids per report but counts every drop', async () => {
      const { lane, localDrops } = makeLane({ maxQueueSize: 1 })
      for (let i = 0; i <= 150; i++) {
        lane.enqueue(msg(i))
      }

      await lane.flush()

      expect(localDrops).toHaveLength(1)
      expect(localDrops[0].drops).toHaveLength(100)
      expect(localDrops[0].message).toContain('Dropped 150 event(s)')
    })
  })

  describe('flush triggers', () => {
    it('flushes when the queue reaches flushAt and hands the flush to onBackgroundFlush', async () => {
      const { lane, batches, backgroundFlushes } = makeLane({ flushAt: 2 })

      lane.enqueue(msg(1))
      expect(batches).toEqual([])
      lane.enqueue(msg(2))
      await Promise.all(backgroundFlushes)

      expect(batches).toEqual([['u1', 'u2']])
      expect(backgroundFlushes).toHaveLength(1)
    })

    it('lets events enqueued in the same burst as the flushAt trigger join its batch', async () => {
      const { lane, batches, backgroundFlushes } = makeLane({ flushAt: 2 })

      for (let i = 1; i <= 5; i++) {
        lane.enqueue(msg(i))
      }
      await Promise.all(backgroundFlushes)

      expect(batches).toEqual([ids(5)])
    })

    it('flushes once flushIntervalMs passes after the first queued event', async () => {
      const { lane, batches, backgroundFlushes } = makeLane({ flushIntervalMs: 1000 })

      lane.enqueue(msg(1))
      await vi.advanceTimersByTimeAsync(500)
      lane.enqueue(msg(2))
      await vi.advanceTimersByTimeAsync(499)
      expect(batches).toEqual([])

      await vi.advanceTimersByTimeAsync(1)
      await Promise.all(backgroundFlushes)
      expect(batches).toEqual([['u1', 'u2']])
      expect(vi.getTimerCount()).toBe(0)
    })

    it('arms no timer when flushIntervalMs is 0', () => {
      const { lane } = makeLane({ flushIntervalMs: 0 })

      lane.enqueue(msg(1))

      expect(vi.getTimerCount()).toBe(0)
    })

    it('arms the timer for an oversized event so its drop report goes out', async () => {
      const { lane, localDrops } = makeLane({ flushIntervalMs: 1000, maxEventBytes: 100 })

      lane.enqueue(msg(1, { pad: 'x'.repeat(200) }))
      await vi.advanceTimersByTimeAsync(1000)

      expect(localDrops).toHaveLength(1)
    })

    it('coalesces flush requests made while a flush is in flight into one follow-up', async () => {
      let release!: () => void
      const { lane, batches, setBehavior } = makeLane()
      setBehavior(() => new Promise((resolve) => (release = () => resolve([]))))
      lane.enqueue(msg(1))
      const first = lane.flush()
      await settle()
      lane.enqueue(msg(2))
      const second = lane.flush()
      const third = lane.flush()

      expect(third).toBe(second)
      setBehavior(accept)
      release()
      await Promise.all([first, second])

      expect(batches).toEqual([['u1'], ['u2']])
    })
  })

  describe('network failure requeue', () => {
    it('puts unsent events back at the head of the queue for the next flush, without reporting', async () => {
      const { lane, batches, localDrops, errors, flushes, setBehavior } = makeLane({ maxBatchSize: 2 })
      setBehavior(keepAll)
      lane.enqueue(msg(1))
      lane.enqueue(msg(2))
      lane.enqueue(msg(3))

      await lane.flush()
      // The first failed batch stops the cycle, so u3 is not tried against a down network.
      expect(batches).toEqual([['u1', 'u2']])
      expect(lane.length).toBe(3)

      lane.enqueue(msg(4))
      setBehavior(accept)
      await lane.flush()

      expect(batches.slice(1)).toEqual([
        ['u1', 'u2'],
        ['u3', 'u4'],
      ])
      expect(flushes).toEqual([['u1', 'u2', 'u3', 'u4']])
      expect(localDrops).toEqual([])
      expect(errors).toEqual([])
    })

    it('requeues only the unsent events of a batch and reports the rest as flushed', async () => {
      const { lane, flushes, setBehavior, batches } = makeLane()
      setBehavior((events) => Promise.resolve(events.filter((event) => event.uuid === 'u2')))
      lane.enqueue(msg(1))
      lane.enqueue(msg(2))

      await lane.flush()
      setBehavior(accept)
      await lane.flush()

      expect(batches).toEqual([['u1', 'u2'], ['u2']])
      expect(flushes).toEqual([['u1'], ['u2']])
    })

    it('keeps the queue cap when requeueing, dropping the oldest first', async () => {
      let release!: () => void
      const { lane, localDrops, setBehavior, batches } = makeLane({ maxQueueSize: 3 })
      setBehavior((events) => new Promise((resolve) => (release = () => resolve(events))))
      lane.enqueue(msg(1))
      lane.enqueue(msg(2))
      const flush = lane.flush()
      await settle()
      for (let i = 3; i <= 5; i++) {
        lane.enqueue(msg(i))
      }
      release()
      await flush

      expect(localDrops).toHaveLength(1)
      expect(localDrops[0].drops.map((drop) => drop.uuid)).toEqual(['u1', 'u2'])

      setBehavior(accept)
      await lane.flush()
      expect(batches.at(-1)).toEqual(['u3', 'u4', 'u5'])
    })

    it('reports an unexpected sender failure and drops that batch instead of requeueing it', async () => {
      const { lane, errors, flushes, setBehavior } = makeLane()
      setBehavior(() => Promise.reject(new Error('bug')))
      lane.enqueue(msg(1))

      await expect(lane.flush()).resolves.toBeUndefined()

      expect(errors).toEqual([new Error('bug')])
      expect(flushes).toEqual([])
      expect(lane.length).toBe(0)
    })
  })

  describe('shutdown', () => {
    const abortable: SendBehavior = (events, { signal }) =>
      new Promise((resolve) => signal?.addEventListener('abort', () => resolve(events), { once: true }))

    it('aborts sends at the deadline and reports what is still queued', async () => {
      const { lane, send, localDrops } = makeLane({}, abortable)
      lane.enqueue(msg(1))
      lane.enqueue(msg(2))

      let drained = false
      const drain = lane.drain(Date.now() + 1000).then(() => (drained = true))
      await vi.advanceTimersByTimeAsync(999)
      expect(drained).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await drain
      expect(send.mock.calls[0][1].signal.aborted).toBe(true)

      lane.finishShutdown()
      expect(localDrops).toHaveLength(1)
      expect(localDrops[0]).toMatchObject({ retryExhausted: ['u1', 'u2'], drops: [] })
      expect(localDrops[0].message).toBe(
        '2 event(s) for /i/v1/analytics/events were still queued when shutdown ended and were not sent'
      )
      expect(lane.length).toBe(0)
    })

    it('reports leftovers and local drops at shutdown in one report with one summary line', async () => {
      const { lane, localDrops, summaries } = makeLane({ maxQueueSize: 2, maxEventBytes: 500 }, abortable)
      lane.enqueue(msg(1, { pad: 'x'.repeat(1000) }))
      lane.enqueue(msg(2))
      lane.enqueue(msg(3))
      lane.enqueue(msg(4))

      lane.finishShutdown()

      expect(localDrops.map((error) => [error.retryExhausted, error.drops.map((drop) => drop.uuid)])).toEqual([
        [['u3', 'u4'], []],
        [[], ['u1', 'u2']],
      ])
      expect(summaries).toEqual([
        '4 event(s) were not delivered to /i/v1/analytics/events: 2 still queued when shutdown ended, ' +
          '1 dropped because the queue was full (2 events), 1 dropped because they were larger than 500 bytes',
      ])
    })

    it('drains events enqueued while an earlier flush was in flight', async () => {
      let release!: () => void
      const { lane, batches, setBehavior } = makeLane()
      setBehavior(() => new Promise((resolve) => (release = () => resolve([]))))
      lane.enqueue(msg(1))
      void lane.flush()
      await settle()
      lane.enqueue(msg(2))

      const drain = lane.drain(Date.now() + 1000)
      setBehavior(accept)
      release()
      await drain

      expect(batches).toEqual([['u1'], ['u2']])
    })

    it('stops draining when a cycle sends nothing', async () => {
      const { lane, send } = makeLane({}, keepAll)
      lane.enqueue(msg(1))

      await lane.drain(Date.now() + 1000)

      expect(send).toHaveBeenCalledTimes(1)
      expect(lane.length).toBe(1)
    })

    it('sends again after shutdown finishes', async () => {
      const { lane, batches, setBehavior } = makeLane({}, abortable)
      lane.enqueue(msg(1))
      const drain = lane.drain(Date.now() + 10)
      await vi.advanceTimersByTimeAsync(10)
      await drain
      lane.finishShutdown()

      setBehavior((_events, { signal }) => Promise.resolve(signal?.aborted ? _events : []))
      lane.enqueue(msg(2))
      await lane.flush()

      expect(batches.at(-1)).toEqual(['u2'])
      expect(lane.length).toBe(0)
    })
  })
})

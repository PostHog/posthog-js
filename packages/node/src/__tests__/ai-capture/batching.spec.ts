import { Buffer } from 'node:buffer'

import { partitionAiBatch } from '@/ai-capture/batching'

const eventOfBytes = (name: string, bytes: number): any => {
  return { event: name, properties: { pad: 'x'.repeat(bytes) } }
}

describe('partitionAiBatch', () => {
  it('passes small events through as a single batch and skips undefined entries', () => {
    const { batches, dropped } = partitionAiBatch([eventOfBytes('a', 10), undefined, eventOfBytes('b', 10)])
    expect(batches).toHaveLength(1)
    expect(batches[0].map((event) => event.event)).toEqual(['a', 'b'])
    expect(dropped).toEqual([])
  })

  it('drops events over the per-event cap, reporting name and size only', () => {
    const { batches, dropped } = partitionAiBatch([eventOfBytes('huge', 300), eventOfBytes('ok', 10)], 200, 1000)
    expect(batches).toHaveLength(1)
    expect(batches[0].map((event) => event.event)).toEqual(['ok'])
    expect(dropped).toHaveLength(1)
    expect(dropped[0].event).toBe('huge')
    expect(dropped[0].bytes).toBeGreaterThan(200)
    expect(Object.keys(dropped[0]).sort()).toEqual(['bytes', 'event'])
  })

  it('applies the per-event cap to UTF-8 bytes, not string length', () => {
    const huge = { event: 'huge', properties: { pad: '界'.repeat(100) } }
    const small = eventOfBytes('ok', 10)
    const bytes = Buffer.byteLength(JSON.stringify(huge), 'utf8')
    expect(JSON.stringify(huge).length).toBeLessThan(200)
    expect(bytes).toBeGreaterThan(200)

    expect(partitionAiBatch([huge, small], 200, 1000)).toEqual({
      batches: [[small]],
      dropped: [{ event: 'huge', bytes }],
    })
  })

  it('packs greedily under the target batch size', () => {
    const events = [eventOfBytes('a', 400), eventOfBytes('b', 400), eventOfBytes('c', 400)]
    const { batches, dropped } = partitionAiBatch(events, 2000, 1000)
    expect(batches.map((batch) => batch.map((event) => event.event))).toEqual([['a', 'b'], ['c']])
    expect(dropped).toEqual([])
  })

  it('packs multibyte events according to their aggregate UTF-8 bytes', () => {
    const events = ['a', 'b', 'c'].map((event) => ({ event, properties: { pad: '界'.repeat(100) } }))
    const sizes = events.map((event) => Buffer.byteLength(JSON.stringify(event), 'utf8'))
    const target = sizes[0] + sizes[1]
    expect(events.reduce((sum, event) => sum + JSON.stringify(event).length, 0)).toBeLessThan(target)
    expect(sizes.reduce((sum, bytes) => sum + bytes, 0)).toBeGreaterThan(target)

    expect(partitionAiBatch(events, 2000, target)).toEqual({
      batches: [[events[0], events[1]], [events[2]]],
      dropped: [],
    })
  })

  it('allows a single event above the target (but under the cap) alone in its batch', () => {
    const { batches, dropped } = partitionAiBatch([eventOfBytes('big', 1500)], 2000, 1000)
    expect(batches.map((batch) => batch.map((event) => event.event))).toEqual([['big']])
    expect(dropped).toEqual([])
  })

  it('reports a non-string event name as unknown', () => {
    const { dropped } = partitionAiBatch([{ properties: { pad: 'x'.repeat(300) } } as any], 200, 1000)
    expect(dropped[0].event).toBe('unknown')
  })
})

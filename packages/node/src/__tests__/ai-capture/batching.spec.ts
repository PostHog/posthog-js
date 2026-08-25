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

  it('packs greedily under the target batch size', () => {
    const events = [eventOfBytes('a', 400), eventOfBytes('b', 400), eventOfBytes('c', 400)]
    const { batches, dropped } = partitionAiBatch(events, 2000, 1000)
    expect(batches.map((batch) => batch.map((event) => event.event))).toEqual([['a', 'b'], ['c']])
    expect(dropped).toEqual([])
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

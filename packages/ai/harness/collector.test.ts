import { gzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { startCollector } from './collector'

it.each(['$ai_generation', '$ai_embedding'])(
  'accepts compressed %s analytics and retains decode failures',
  async (eventName) => {
    const collector = await startCollector()
    try {
      const event = { event: eventName, distinct_id: 'test', properties: {} }
      const response = await fetch(`${collector.url}/batch/`, {
        method: 'POST',
        headers: { 'content-encoding': 'gzip' },
        body: gzipSync(JSON.stringify({ api_key: 'phc_cassette_test', batch: [event] })),
      })
      expect(response.status).toBe(200)
      expect(collector.events).toEqual([event])
      collector.verify()
      const invalid = await fetch(`${collector.url}/batch/`, {
        method: 'POST',
        headers: { 'content-encoding': 'gzip' },
        body: 'not gzip',
      })
      expect(invalid.status).toBe(500)
      expect(() => collector.verify()).toThrow('Analytics collector failed')
    } finally {
      await collector.close()
    }
  }
)

it('rejects non-AI events', async () => {
  const collector = await startCollector()
  try {
    const response = await fetch(`${collector.url}/batch/`, {
      method: 'POST',
      body: JSON.stringify({
        api_key: 'phc_cassette_test',
        batch: [{ event: '$pageview', distinct_id: 'test', properties: {} }],
      }),
    })
    expect(response.status).toBe(500)
    expect(collector.events).toHaveLength(0)
    expect(() => collector.verify()).toThrow('Analytics collector failed')
  } finally {
    await collector.close()
  }
})

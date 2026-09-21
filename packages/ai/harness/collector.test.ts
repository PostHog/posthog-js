import { gzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { startCollector } from './collector'

it.each(['$ai_generation', '$ai_embedding', '$pageview'])('only accepts supported AI events: %s', async (event) => {
  const collector = await startCollector()
  try {
    const item = { event, distinct_id: 'test', properties: {} }
    const response = await fetch(`${collector.url}/batch/`, {
      method: 'POST',
      body: JSON.stringify({ api_key: 'phc_cassette_test', batch: [item] }),
    })
    expect(response.status).toBe(event === '$pageview' ? 500 : 200)
    expect(collector.events).toEqual(event === '$pageview' ? [] : [item])
    if (event === '$pageview') expect(() => collector.verify()).toThrow('Analytics collector failed')
    else collector.verify()
  } finally {
    await collector.close()
  }
})

it('accepts compressed analytics and retains decode failures', async () => {
  const collector = await startCollector()
  try {
    const event = { event: '$ai_generation', distinct_id: 'test', properties: {} }
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
})

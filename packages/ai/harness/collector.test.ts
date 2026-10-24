import { gzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { startCollector } from './collector'

const AUTH = { authorization: 'Bearer phc_cassette_test' }

function legacyBody(batch: unknown[]): string {
  return JSON.stringify({ api_key: 'phc_cassette_test', batch })
}

function v1Body(batch: unknown[]): string {
  return JSON.stringify({ created_at: '2026-01-01T00:00:00.000Z', batch })
}

function v1Event(event: string, options: Record<string, unknown> = {}) {
  return {
    event,
    uuid: '01890000-0000-7000-8000-000000000000',
    distinct_id: 'test',
    timestamp: '2026-01-01T00:00:00.000Z',
    session_id: 'session-1',
    options,
    properties: {},
  }
}

it.each([
  ['$ai_generation', '/i/v1/ai/events'],
  ['$ai_embedding', '/i/v1/ai/events/'],
  ['$ai_generation', '/i/v1/analytics/events'],
])('accepts compressed %s analytics on %s and retains decode failures', async (eventName, path) => {
  const collector = await startCollector()
  try {
    const response = await fetch(`${collector.url}${path}`, {
      method: 'POST',
      headers: { ...AUTH, 'content-encoding': 'gzip' },
      body: gzipSync(v1Body([v1Event(eventName)])),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results: {} })
    expect(collector.events).toEqual([
      {
        event: eventName,
        uuid: '01890000-0000-7000-8000-000000000000',
        distinct_id: 'test',
        timestamp: '2026-01-01T00:00:00.000Z',
        properties: { $session_id: 'session-1' },
      },
    ])
    collector.verify()
    const invalid = await fetch(`${collector.url}${path}`, {
      method: 'POST',
      headers: { ...AUTH, 'content-encoding': 'gzip' },
      body: 'not gzip',
    })
    expect(invalid.status).toBe(500)
    expect(() => collector.verify()).toThrow('Analytics collector failed')
  } finally {
    await collector.close()
  }
})

it('reads capture v1 options as the legacy properties they replace', async () => {
  const collector = await startCollector()
  try {
    const response = await fetch(`${collector.url}/i/v1/analytics/events`, {
      method: 'POST',
      headers: AUTH,
      body: v1Body([v1Event('$ai_generation', { process_person_profile: false })]),
    })
    expect(response.status).toBe(200)
    expect(collector.events[0].properties).toEqual({ $session_id: 'session-1', $process_person_profile: false })
    collector.verify()
  } finally {
    await collector.close()
  }
})

it.each([
  ['non-AI events', '/i/v1/ai/events', AUTH, v1Body([v1Event('$pageview')])],
  [
    'the legacy batch endpoint',
    '/batch/',
    AUTH,
    legacyBody([{ event: '$ai_generation', distinct_id: 'test', properties: {} }]),
  ],
  ['a missing bearer token', '/i/v1/ai/events', {}, v1Body([v1Event('$ai_generation')])],
  ['a legacy body on a v1 endpoint', '/i/v1/ai/events', AUTH, legacyBody([])],
  [
    'events without v1 fields',
    '/i/v1/ai/events',
    AUTH,
    v1Body([{ event: '$ai_generation', distinct_id: 'test', properties: {} }]),
  ],
])('rejects %s', async (_name, path, headers, body) => {
  const collector = await startCollector()
  try {
    const response = await fetch(`${collector.url}${path}`, { method: 'POST', headers, body })
    expect(response.status).toBe(500)
    expect(collector.events).toHaveLength(0)
    expect(() => collector.verify()).toThrow('Analytics collector failed')
  } finally {
    await collector.close()
  }
})

/** @vitest-environment node */

import type { PostHogFetchOptions } from '@posthog/core'

import { V1CaptureSender } from '@/capture-v1/sender'
import { serializeV1Event } from '@/capture-v1/serialize'
import { PostHog } from '@/entrypoints/index.node'
import { captureCalls, v1Response } from './utils'
import { okResponse } from './utils/v1-wiring'

type FetchCall = [string, PostHogFetchOptions]

const FIXED_NOW = new Date('2025-02-03T04:05:06.789Z')
const FIXED_EVENT_UUID = '0194cc39-1f25-7000-8000-000000000001'
const FIXED_REQUEST_ID = '0194cc39-1f25-7000-8000-000000000002'

function normalizeSnapshot(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSnapshot(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([childKey, childValue]) => [childKey, normalizeSnapshot(childValue, childKey)])
    )
  }
  if (typeof value === 'string') {
    if (key?.toLowerCase() === 'authorization') {
      const separatorIndex = value.indexOf(' ')
      return separatorIndex === -1 ? '<redacted>' : `${value.slice(0, separatorIndex)} <redacted>`
    }
    const normalizedKey = key?.toLowerCase()
    if (normalizedKey && ['api_key', 'token'].includes(normalizedKey)) {
      return '<redacted>'
    }
    if (normalizedKey === '$lib_version') {
      return '<sdk-version>'
    }
    if (normalizedKey && ['posthog-sdk-info', 'user-agent'].includes(normalizedKey)) {
      return value.replace(/^(posthog-node)\/.+$/, '$1/<sdk-version>')
    }
    return value.replaceAll(process.cwd(), '<project-root>')
  }
  return value
}

function snapshotRequest([url, options]: FetchCall): unknown {
  const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body
  return normalizeSnapshot({
    body,
    headers: options.headers,
    method: options.method,
    url,
  })
}

describe('server wire snapshots', () => {
  const mockedFetch = vi.spyOn(globalThis, 'fetch').mockImplementation()
  const clients: PostHog[] = []

  beforeEach(() => {
    vi.setSystemTime(FIXED_NOW)
    mockedFetch.mockImplementation((url) =>
      Promise.resolve((url as string).includes('/i/v1/analytics/events') ? v1Response() : okResponse())
    )
  })

  afterEach(async () => {
    while (clients.length) {
      await clients.pop()?.shutdown()
    }
  })

  it('snapshots the canonical Capture V1 transform and request matrix', async () => {
    const sender = new V1CaptureSender(
      {
        host: 'https://us.example.test',
        path: '/i/v1/analytics/events',
        apiKey: 'phc_capture_secret',
        libraryId: 'posthog-node',
        libraryVersion: '1.2.3',
        userAgent: 'posthog-node/1.2.3',
        historicalMigration: false,
        compressionEnabled: false,
        requestTimeoutMs: 1_000,
        maxAttempts: 1,
        initialRetryDelayMs: 10,
      },
      {
        fetch: mockedFetch as any,
        onError: (error) => {
          throw error
        },
        now: () => FIXED_NOW.getTime(),
        generateRequestId: () => FIXED_REQUEST_ID,
      }
    )

    const messages = [
      {
        event: 'options-and-legacy-properties',
        distinct_id: 'person-1',
        uuid: FIXED_EVENT_UUID,
        timestamp: '2025-02-03T05:05:06.123456+01:00',
        $set: { plan: 'pro' },
        $set_once: { first_seen: '2025-02-03' },
        options: { process_person_profile: true, future_option: 'kept' },
        properties: {
          $cookieless_mode: '1',
          $ignore_sent_at: 'false',
          $lib: 'posthog-node',
          $lib_version: '1.2.3',
          $process_person_profile: 0,
          $product_tour_id: 'tour-7',
          $session_id: 'session-7',
          $window_id: 'window-7',
          nested: { z: 1, a: ['second', 'first'] },
        },
      },
      {
        event: 'legacy-option-values-sent-unchanged',
        distinct_id: 'person-2',
        uuid: '0194cc39-1f25-7000-8000-000000000003',
        timestamp: '2025-02-03T04:05:07.000Z',
        properties: {
          $cookieless_mode: 'maybe',
          $ignore_sent_at: null,
          $process_person_profile: [],
          $product_tour_id: 7,
          $session_id: 123,
          $window_id: false,
          ordinary: true,
        },
      },
    ]
    await sender.send(messages.map(serializeV1Event))

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(snapshotRequest(mockedFetch.mock.calls[0] as FetchCall)).toMatchSnapshot()
  })

  it('snapshots a deterministic complete captureException wire event', async () => {
    const posthog = new PostHog('phc_exception_secret', {
      host: 'https://us.example.test',
      fetchRetryCount: 0,
      disableCompression: true,
    })
    clients.push(posthog)

    const error = new TypeError('database unavailable')
    error.stack = [
      'TypeError: database unavailable',
      '    at runQuery (service/src/db.ts:41:13)',
      '    at handler (service/src/handler.ts:12:5)',
    ].join('\n')

    posthog.captureException(
      error,
      'person-exception',
      {
        endpoint: '/v1/orders',
        request: { method: 'POST', tags: ['checkout', 'priority'] },
        status_code: 503,
      },
      FIXED_EVENT_UUID
    )
    await (posthog as any).promiseQueue.join()
    await posthog.flush()

    const calls = captureCalls(mockedFetch)
    expect(calls).toHaveLength(1)
    const [url, options] = calls[0] as FetchCall
    const headers = options.headers as Record<string, string>
    // The client generates a fresh request id per batch, so pin its shape rather than its value.
    expect(headers['PostHog-Request-Id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(
      snapshotRequest([url, { ...options, headers: { ...headers, 'PostHog-Request-Id': '<generated>' } }])
    ).toMatchSnapshot()
  })

  it('snapshots a maximal flags request body', async () => {
    mockedFetch.mockImplementation((url) => {
      if ((url as string).includes('/flags/')) {
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('ok'),
          json: () => Promise.resolve({ flags: {}, errorsWhileComputingFlags: false }),
        } as any)
      }
      return Promise.resolve(okResponse())
    })

    const posthog = new PostHog('phc_flags_secret', {
      host: 'https://us.example.test',
      fetchRetryCount: 0,
      evaluationContexts: ['production', 'backend'],
    })
    clients.push(posthog)

    await posthog.getAllFlagsAndPayloads('person-flags', {
      groups: { company: 'company-7', project: 'project-9' },
      personProperties: {
        $device_id: 'device-3',
        email: 'person@example.test',
        plan: 'enterprise',
      },
      groupProperties: {
        company: { name: 'Acme', seats: 42 },
        project: { region: 'eu-west-1', tier: 'critical' },
      },
      disableGeoip: false,
      flagKeys: ['new-checkout', 'billing-v2'],
    })

    const call = mockedFetch.mock.calls.find(([url]) => (url as string).includes('/flags/?v=2')) as FetchCall
    expect(snapshotRequest(call)).toMatchSnapshot()
  })
})

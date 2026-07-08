import { PostHog, PostHogOptions } from '@/entrypoints/index.node'

import { waitForPromises } from '.'

export const V1_URL = 'http://example.com/i/v1/analytics/events'

/** A Capture V1 2xx response whose per-event `results` map defaults to all-accepted. */
export function v1Response(results: Record<string, unknown> = {}): any {
  const body = JSON.stringify({ results })
  return {
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve({ results }),
    headers: { get: () => null },
    body: null,
  }
}

/** A legacy `/batch/` 2xx response. */
export function v0Response(): any {
  return {
    status: 200,
    text: () => Promise.resolve('ok'),
    json: () => Promise.resolve({ status: 'ok' }),
    headers: { get: () => null },
    body: null,
  }
}

/** Default fetch behavior: the v1 endpoint returns all-accepted, everything else a v0 200. */
export function routeByUrl(url: string): any {
  return url.includes('/i/v1/analytics/events') ? v1Response() : v0Response()
}

/**
 * Shared fixture for the Capture V1 wiring/integration specs: owns the global `fetch` spy, tracks
 * clients for teardown, and exposes call inspectors so each suite only writes its own scenario.
 */
export class V1WiringHarness {
  readonly fetch: jest.SpyInstance
  private readonly clients: PostHog[] = []

  constructor() {
    this.fetch = jest.spyOn(globalThis, 'fetch').mockImplementation()
  }

  /** (Re)install the default per-URL routing. Call from `beforeEach` (after `clearAllMocks`). */
  useDefaultRouting(): void {
    this.fetch.mockImplementation((url: any) => Promise.resolve(routeByUrl(url as string)))
  }

  makeClient(options: PostHogOptions = {}): PostHog {
    const client = new PostHog('TEST_API_KEY', {
      host: 'http://example.com',
      fetchRetryCount: 0,
      disableCompression: true,
      ...options,
    })
    this.clients.push(client)
    return client
  }

  /** All fetch calls whose URL contains `fragment`, as `[url, options]` tuples. */
  callsTo(fragment: string): [string, any][] {
    return this.fetch.mock.calls.filter((call: any[]) => (call[0] as string).includes(fragment)) as [string, any][]
  }

  /** Event names carried in every batch posted to a URL containing `fragment`, in call order. */
  eventsIn(fragment: string): string[] {
    return this.callsTo(fragment).flatMap((call) => JSON.parse(call[1].body).batch.map((event: any) => event.event))
  }

  async cleanup(): Promise<void> {
    while (this.clients.length) {
      await this.clients.pop()?.shutdown()
    }
  }
}

/** Drains the enqueue flush timer plus its follow-up microtasks (fake timers must be enabled). */
export const waitForFlushTimer = async (): Promise<void> => {
  await waitForPromises()
  jest.runOnlyPendingTimers()
  await waitForPromises()
}

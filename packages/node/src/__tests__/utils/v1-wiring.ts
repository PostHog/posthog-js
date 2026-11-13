import { PostHog, PostHogOptions } from '@/entrypoints/index.node'

import { captureCalls, captureEvents, isCaptureUrl, v1Response, waitForPromises } from '.'

/** A generic 2xx response for the non-capture endpoints (logs, metrics, flags). */
export function okResponse(): any {
  return {
    status: 200,
    text: () => Promise.resolve('ok'),
    json: () => Promise.resolve({ status: 'ok' }),
    headers: { get: () => null },
    body: null,
  }
}

/** Default fetch behavior: capture endpoints accept every event, everything else returns a 200. */
export function routeByUrl(url: string): any {
  return isCaptureUrl(url) ? v1Response() : okResponse()
}

/**
 * Shared fixture for the capture wiring/integration specs: owns the global `fetch` spy, tracks
 * clients for teardown, and exposes call inspectors so each suite only writes its own scenario.
 */
export class V1WiringHarness {
  readonly fetch: vi.SpyInstance
  private readonly clients: PostHog[] = []

  constructor() {
    this.fetch = vi.spyOn(globalThis, 'fetch').mockImplementation()
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
      // The AI lane ignores disableCompression.
      captureAiCompression: 'none',
      ...options,
    })
    this.clients.push(client)
    return client
  }

  /** All fetch calls whose URL contains `fragment`, as `[url, options]` tuples. */
  callsTo(fragment: string): [string, any][] {
    return captureCalls(this.fetch, fragment)
  }

  /** Event names carried in every batch posted to a URL containing `fragment`, in call order. */
  eventsIn(fragment: string): string[] {
    return captureEvents(this.fetch, fragment).map((event: any) => event.event)
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
  vi.runOnlyPendingTimers()
  await waitForPromises()
}

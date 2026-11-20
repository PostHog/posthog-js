// @vitest-environment jsdom
import { createPostHog as createCore } from '../src/composition/npm/core'
import type { BrowserFetch, BrowserNavigator } from '../src/core/types'
import { sessionRecording } from '../src/products/session-recording/session-recording'
import {
    clients,
    MemoryStorage,
    remoteConfig,
    resetDocument,
    shutdownClients,
    started,
} from './session-recording-helpers'

beforeEach(() => {
    resetDocument()
    // text gzip cannot shrink much, so replay's first unload send is large (about 40 KB as a base64 body)
    const div = document.createElement('div')
    div.textContent = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(15_000))))
    document.body.appendChild(div)
})
afterEach(shutdownClients)

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

const recordingPage = async (withBeacon: boolean) => {
    const analytics: Array<{ keepalive: boolean | undefined; events: string[] }> = []
    const replaySends: string[] = []
    const fetch: BrowserFetch = async (input, init = {}) => {
        const url = String(input)
        if (url.includes('/i/v1/analytics/events')) {
            const body = JSON.parse(String(init.body)) as { batch: Array<{ uuid: string; event: string }> }
            analytics.push({ keepalive: init.keepalive, events: body.batch.map((event) => event.event) })
            const results = Object.fromEntries(body.batch.map((event) => [event.uuid, { result: 'ok' }]))
            return new Response(JSON.stringify({ results }), { status: 200 })
        }
        if (url.includes('/s/')) replaySends.push(`fetch keepalive=${String(init.keepalive)}`)
        return new Response('{}', { status: 200 })
    }
    const navigator: BrowserNavigator = withBeacon
        ? {
              onLine: true,
              sendBeacon: () => {
                  replaySends.push('beacon')
                  return true
              },
          }
        : { onLine: true }
    const replay = sessionRecording()
    const posthog = await createCore({
        projectToken: 'ph_test',
        apiHost: 'https://us.i.posthog.com',
        capturePageview: false,
        storage: new MemoryStorage(),
        navigator,
        fetch,
        remoteConfig: remoteConfig({}),
        analytics: { flushAt: 100, flushInterval: 0 },
        extensions: [replay],
    })
    clients.push(posthog)
    await started(replay)
    return { posthog, analytics, replaySends }
}

describe('session recording unload delivery', () => {
    it.each([
        ['beacons', true],
        ['keepalive requests', false],
    ])(
        'leaves the keepalive budget to analytics after replay sent %s on an earlier unload',
        async (_transport, withBeacon) => {
            const { posthog, analytics, replaySends } = await recordingPage(withBeacon)

            // the page enters the back/forward cache, replay hands its data to the browser, and the page is restored
            window.dispatchEvent(new Event('pagehide'))
            await settle()
            window.dispatchEvent(new Event('pageshow'))
            posthog.capture('after_restore', { detail: 'x'.repeat(20_000) })
            window.dispatchEvent(new Event('pagehide'))

            expect(replaySends[0]).toBe(withBeacon ? 'beacon' : 'fetch keepalive=true')
            expect(analytics.find((request) => request.events.includes('after_restore'))?.keepalive).toBe(true)
        }
    )
})

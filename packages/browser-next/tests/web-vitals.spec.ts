// @vitest-environment jsdom
import { WEB_VITALS_ENABLED_SERVER_SIDE } from '@posthog/browser-common/constants'
import { createPostHog as createRoot } from '../src/composition/npm/index'
import { createPostHog as createCore } from '../src/composition/npm/core'
import type { CorePostHogOptions, IPostHog, PostHogOptions, RemoteConfig, StorageLike } from '../src/core/types'
import { webVitals } from '../src/products/web-vitals/web-vitals'

type Report = (metric: Record<string, unknown>) => void
type Observer = (onReport: Report, opts?: Record<string, unknown>) => void

const library = vi.hoisted(() => {
    const observers = () => ({ onLCP: vi.fn(), onCLS: vi.fn(), onFCP: vi.fn(), onINP: vi.fn() })
    return { plain: observers(), attributed: observers() }
})

vi.mock('../src/products/web-vitals/web-vitals-library', () => {
    return library.plain
})
vi.mock('../src/products/web-vitals/web-vitals-attribution-library', () => {
    return library.attributed
})

class MemoryStorage implements StorageLike {
    readonly values = new Map<string, string>()
    getItem(key: string): string | null {
        return this.values.get(key) ?? null
    }
    setItem(key: string, value: string): void {
        this.values.set(key, value)
    }
    removeItem(key: string): void {
        this.values.delete(key)
    }
}

const remoteConfig = (overrides: Partial<RemoteConfig> = {}): RemoteConfig => ({
    supportedCompression: [],
    toolbarParams: {},
    toolbarVersion: 'toolbar',
    isAuthenticated: false,
    siteApps: [],
    ...overrides,
})

const coreOptions = (overrides: Partial<CorePostHogOptions> = {}): CorePostHogOptions => ({
    projectToken: 'ph_web_vitals',
    storage: new MemoryStorage(),
    navigator: false,
    fetch: false,
    capturePageview: false,
    remoteConfig: remoteConfig(),
    ...overrides,
})

const rootOptions = (overrides: Partial<PostHogOptions> = {}): PostHogOptions => ({
    ...coreOptions(),
    flags: false,
    logs: false,
    surveys: false,
    autocapture: false,
    ...overrides,
})

const reporter = (observer: Observer): Report => {
    const report = vi.mocked(observer).mock.calls[0]?.[0]
    if (!report) throw new Error('Observer was not registered')
    return report
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const waitForObservers = () => vi.waitFor(() => expect(library.plain.onLCP).toHaveBeenCalled())

const clients: IPostHog[] = []
const track = (client: IPostHog) => {
    clients.push(client)
    const events: Array<{ event: string; properties: Record<string, unknown> }> = []
    client.onEvent(({ event, properties }) => {
        if (event === '$web_vitals') events.push({ event, properties: properties as Record<string, unknown> })
    })
    return events
}

afterEach(async () => {
    for (const client of clients.splice(0)) await client.shutdown(0)
    vi.useRealTimers()
    vi.clearAllMocks()
})

describe('web vitals', () => {
    it('captures all allowed metrics in one $web_vitals event with the posthog-js shape', async () => {
        const client = await createCore(coreOptions({ extensions: [webVitals({ enabled: true, attribution: false })] }))
        const events = track(client)
        // Metrics carry the session of earlier activity, which reading the session does not create.
        client.capture('activity')
        await waitForObservers()
        expect(library.attributed.onLCP).not.toHaveBeenCalled()

        for (const [name, observer] of Object.entries({
            LCP: library.plain.onLCP,
            CLS: library.plain.onCLS,
            FCP: library.plain.onFCP,
            INP: library.plain.onINP,
        })) {
            reporter(observer)({ name, value: 100, rating: 'good', entries: [{}], attribution: { target: 'div' } })
        }

        expect(events).toHaveLength(1)
        const { properties } = events[0]!
        expect(properties.$current_url).toBe(window.location.href)
        expect(properties.$web_vitals_LCP_value).toBe(100)
        expect(properties.$web_vitals_INP_value).toBe(100)
        expect(properties.$web_vitals_LCP_event).toEqual({
            name: 'LCP',
            value: 100,
            rating: 'good',
            $current_url: window.location.href,
            timestamp: expect.any(Number),
            $session_id: client.session?.sessionId,
            $window_id: client.session?.windowId,
        })
    })

    it('attributes INP and LCP by default and keeps CLS and FCP unattributed', async () => {
        const client = await createCore(coreOptions({ extensions: [webVitals({ enabled: true })] }))
        track(client)
        await vi.waitFor(() => expect(library.attributed.onLCP).toHaveBeenCalled())

        expect(library.attributed.onINP).toHaveBeenCalledWith(expect.any(Function), {
            reportSoftNavs: false,
            includeProcessedEventEntries: false,
        })
        expect(library.plain.onCLS).toHaveBeenCalledWith(expect.any(Function), { reportSoftNavs: false })
        expect(library.plain.onFCP).toHaveBeenCalled()
        expect(library.attributed.onCLS).not.toHaveBeenCalled()
        expect(library.plain.onLCP).not.toHaveBeenCalled()
    })

    it('applies allowed metrics, the delayed flush, the maximum value and soft navigations', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const client = await createCore(
            coreOptions({
                extensions: [
                    webVitals({
                        enabled: true,
                        attribution: false,
                        allowedMetrics: ['LCP', 'CLS'],
                        delayedFlushMs: 2000,
                        previewSoftNavigations: true,
                    }),
                ],
            })
        )
        const events = track(client)
        await waitForObservers()
        expect(library.plain.onLCP).toHaveBeenCalledWith(expect.any(Function), { reportSoftNavs: true })
        expect(library.plain.onFCP).not.toHaveBeenCalled()
        expect(library.plain.onINP).not.toHaveBeenCalled()

        // Values at or above the 15-minute outlier limit are discarded.
        reporter(library.plain.onCLS)({ name: 'CLS', value: 900_000 })
        reporter(library.plain.onLCP)({ name: 'LCP', value: 1500 })
        vi.advanceTimersByTime(1999)
        expect(events).toHaveLength(0)
        vi.advanceTimersByTime(1)

        expect(events).toHaveLength(1)
        expect(events[0]!.properties).not.toHaveProperty('$web_vitals_CLS_value')
        expect(events[0]!.properties.$web_vitals_LCP_value).toBe(1500)
    })

    it.each([
        ['the default', undefined, 'http://localhost:3000/page?gclid=abc&utm_source=ads'],
        ['query: false', { query: false }, 'http://localhost:3000/page'],
        [
            'sanitize',
            {
                sanitize: (url: URL) => {
                    url.searchParams.delete('gclid')
                    url.hash = ''
                    return url
                },
            },
            'http://localhost:3000/page?utm_source=ads',
        ],
    ] as const)(
        'records the measured page URL with %s urlSanitization',
        async (_label, urlSanitization, expectedUrl) => {
            window.history.replaceState({}, '', '/page?gclid=abc&utm_source=ads#access_token=secret')
            try {
                const client = await createCore(
                    coreOptions({
                        ...(urlSanitization ? { urlSanitization } : {}),
                        extensions: [webVitals({ enabled: true, attribution: false })],
                    })
                )
                const events = track(client)
                await waitForObservers()
                reporter(library.plain.onLCP)({ name: 'LCP', value: 1200 })
                window.dispatchEvent(new Event('pagehide'))

                expect(events[0]!.properties).toMatchObject({ $current_url: expectedUrl, $pathname: '/page' })
                expect((events[0]!.properties.$web_vitals_LCP_event as Record<string, unknown>).$current_url).toBe(
                    expectedUrl
                )
            } finally {
                window.history.replaceState({}, '', '/')
            }
        }
    )

    it('records the navigation and attribution URLs the library measured with urlSanitization', async () => {
        const client = await createCore(
            coreOptions({
                urlSanitization: { query: false },
                extensions: [webVitals({ enabled: true, attribution: ['LCP'] })],
            })
        )
        const events = track(client)
        await vi.waitFor(() => expect(library.attributed.onLCP).toHaveBeenCalled())
        reporter(library.attributed.onLCP)({
            name: 'LCP',
            value: 1200,
            navigationId: 'soft-1',
            navigationURL: 'http://localhost:3000/route?id=7#tab',
            attribution: { url: 'https://cdn.example/hero.png?sig=secret', target: 'img' },
        })
        window.dispatchEvent(new Event('pagehide'))

        const metric = events[0]!.properties.$web_vitals_LCP_event as Record<string, unknown>
        expect(events[0]!.properties.$current_url).toBe('http://localhost:3000/route')
        expect(metric).toMatchObject({
            navigationURL: 'http://localhost:3000/route',
            $current_url: 'http://localhost:3000/route',
            attribution: { url: 'https://cdn.example/hero.png', target: 'img' },
        })
    })

    it('drops metrics when sanitize fails, as when the page URL is unavailable', async () => {
        const client = await createCore(
            coreOptions({
                urlSanitization: {
                    sanitize: () => {
                        throw new Error('unavailable')
                    },
                },
                extensions: [webVitals({ enabled: true, attribution: false })],
            })
        )
        const events = track(client)
        await waitForObservers()
        reporter(library.plain.onLCP)({ name: 'LCP', value: 1200 })
        window.dispatchEvent(new Event('pagehide'))

        expect(events).toHaveLength(0)
    })

    it('waits for the project setting when not enabled locally', async () => {
        const client = await createCore(coreOptions({ extensions: [webVitals()] }))
        await settle()
        expect(library.plain.onLCP).not.toHaveBeenCalled()
        expect(client.webVitals).toBeDefined()
    })

    it('follows remote enablement and allowed metrics, and saves the server-side hint', async () => {
        const storage = new MemoryStorage()
        const config = remoteConfig({ capturePerformance: { web_vitals: true, web_vitals_allowed_metrics: ['LCP'] } })
        const client = await createCore(
            coreOptions({ storage, remoteConfig: config, extensions: [webVitals({ attribution: false })] })
        )
        const events = track(client)
        await waitForObservers()
        expect(library.plain.onCLS).not.toHaveBeenCalled()
        expect(client.kv.get(WEB_VITALS_ENABLED_SERVER_SIDE)).toBe(true)

        reporter(library.plain.onLCP)({ name: 'LCP', value: 1200 })
        expect(events).toHaveLength(1)
    })

    it('keeps a local opt-out over remote enablement', async () => {
        const config = remoteConfig({ capturePerformance: { web_vitals: true } })
        await createCore(coreOptions({ remoteConfig: config, extensions: [webVitals({ enabled: false })] })).then(track)
        await settle()
        expect(library.plain.onLCP).not.toHaveBeenCalled()
    })

    it('stops capturing after shutdown, including reports from observers that cannot be disconnected', async () => {
        const client = await createCore(coreOptions({ extensions: [webVitals({ enabled: true, attribution: false })] }))
        const events = track(client)
        await waitForObservers()
        clients.splice(0)
        await client.shutdown(0)

        reporter(library.plain.onLCP)({ name: 'LCP', value: 1200 })
        window.dispatchEvent(new Event('pagehide'))
        expect(events).toHaveLength(0)
    })

    it('flushes buffered metrics with unload delivery when the page hides', async () => {
        const client = await createCore(coreOptions({ extensions: [webVitals({ enabled: true, attribution: false })] }))
        const events = track(client)
        await waitForObservers()

        reporter(library.plain.onLCP)({ name: 'LCP', value: 1200 })
        window.dispatchEvent(new Event('pagehide'))

        expect(events).toHaveLength(1)
        expect(events[0]!.properties.$web_vitals_LCP_value).toBe(1200)
    })

    it('drops metrics reported while consent is denied instead of sending them after opt-in', async () => {
        const client = await createCore(
            coreOptions({
                optOutByDefault: true,
                extensions: [webVitals({ enabled: true, attribution: false, allowedMetrics: ['LCP', 'CLS'] })],
            })
        )
        const events = track(client)
        await waitForObservers()

        reporter(library.plain.onLCP)({ name: 'LCP', value: 1201 })
        client.optIn()
        reporter(library.plain.onCLS)({ name: 'CLS', value: 0.1 })
        window.dispatchEvent(new Event('pagehide'))

        expect(events).toHaveLength(1)
        expect(events[0]!.properties).not.toHaveProperty('$web_vitals_LCP_value')
        expect(events[0]!.properties.$web_vitals_CLS_value).toBe(0.1)
    })

    it('discards metrics pending at reset so they do not reach the next identity', async () => {
        const client = await createCore(
            coreOptions({
                extensions: [webVitals({ enabled: true, attribution: false, allowedMetrics: ['LCP', 'CLS'] })],
            })
        )
        const events = track(client)
        client.identify('first-user')
        await waitForObservers()
        reporter(library.plain.onLCP)({ name: 'LCP', value: 1201 })

        client.reset(true)
        client.identify('second-user')
        reporter(library.plain.onCLS)({ name: 'CLS', value: 0.1 })
        window.dispatchEvent(new Event('pagehide'))

        expect(events).toHaveLength(1)
        expect(events[0]!.properties).not.toHaveProperty('$web_vitals_LCP_value')
        expect((events[0]!.properties.$web_vitals_CLS_event as Record<string, unknown>).$session_id).toBe(
            client.session?.sessionId
        )
    })

    it('logs and continues when the library fails to load', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.resetModules()
        vi.doMock('../src/products/web-vitals/web-vitals-library', () => {
            throw new Error('chunk failed')
        })
        try {
            const { createPostHog } = await import('../src/composition/npm/core')
            const { webVitals: isolatedWebVitals } = await import('../src/products/web-vitals/web-vitals')
            const client = await createPostHog(
                coreOptions({ debug: true, extensions: [isolatedWebVitals({ enabled: true, attribution: false })] })
            )
            clients.push(client)
            await vi.waitFor(() =>
                expect(error).toHaveBeenCalledWith('[PostHog]', '[Web Vitals] failed to start', expect.any(Error))
            )
            expect(client.capture('still_capturing')).toBe(true)
        } finally {
            vi.doMock('../src/products/web-vitals/web-vitals-library', () => library.plain)
            error.mockRestore()
        }
    })
})

describe('automatic web vitals', () => {
    it('stays unloaded until the project enables web vitals', async () => {
        const client = await createRoot(rootOptions())
        clients.push(client)
        expect(client.webVitals).toBeUndefined()
        expect(library.plain.onLCP).not.toHaveBeenCalled()
    })

    it('loads when remote config enables web vitals', async () => {
        const client = await createRoot(
            rootOptions({
                remoteConfig: remoteConfig({ capturePerformance: { web_vitals: true } }),
                webVitals: { attribution: false },
            })
        )
        clients.push(client)
        expect(client.webVitals).toBeDefined()
        await waitForObservers()
    })

    it('loads from the saved server-side hint before remote config arrives', async () => {
        const storage = new MemoryStorage()
        const first = await createRoot(
            rootOptions({ storage, remoteConfig: remoteConfig({ capturePerformance: { web_vitals: true } }) })
        )
        await first.shutdown(0)
        vi.clearAllMocks()

        const client = await createRoot(rootOptions({ storage, remoteConfig: remoteConfig() }))
        clients.push(client)
        expect(client.webVitals).toBeDefined()
        await vi.waitFor(() => expect(library.attributed.onLCP).toHaveBeenCalled())
    })

    it('does not start from a saved hint when fresh remote config turns web vitals off', async () => {
        const storage = new MemoryStorage()
        const first = await createRoot(
            rootOptions({ storage, remoteConfig: remoteConfig({ capturePerformance: { web_vitals: true } }) })
        )
        await first.shutdown(0)
        vi.clearAllMocks()

        const client = await createRoot(
            rootOptions({ storage, remoteConfig: remoteConfig({ capturePerformance: { web_vitals: false } }) })
        )
        clients.push(client)
        await settle()
        expect(client.kv.get(WEB_VITALS_ENABLED_SERVER_SIDE)).toBe(false)
        expect(library.attributed.onLCP).not.toHaveBeenCalled()
        expect(library.plain.onCLS).not.toHaveBeenCalled()
    })

    it('loads during initialization when enabled locally', async () => {
        const client = await createRoot(rootOptions({ webVitals: { enabled: true, attribution: false } }))
        clients.push(client)
        expect(client.webVitals).toBeDefined()
        await waitForObservers()
    })

    it.each([false, { enabled: false }] as const)('stays unloaded when configured as %j', async (webVitals) => {
        const client = await createRoot(
            rootOptions({ webVitals, remoteConfig: remoteConfig({ capturePerformance: { web_vitals: true } }) })
        )
        clients.push(client)
        expect(client.webVitals).toBeUndefined()
    })

    it('prefers an explicit extension over the automatic product', async () => {
        const extension = webVitals({ attribution: false })
        const client = await createRoot(
            rootOptions({
                extensions: [extension],
                webVitals: { enabled: true },
                remoteConfig: remoteConfig({ capturePerformance: { web_vitals: true } }),
            })
        )
        clients.push(client)
        expect(client.webVitals).toBe(extension)
    })
})

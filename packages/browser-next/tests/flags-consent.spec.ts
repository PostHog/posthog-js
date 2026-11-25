// @vitest-environment jsdom
// jsdom reports the browser online, so refused flags requests would count toward the status-zero circuit breaker.
import { createPostHog } from '../src/composition/npm'
import type { IPostHog, RemoteConfig } from '../src/core/types'

const remoteConfig: RemoteConfig = {
    supportedCompression: [],
    toolbarParams: {},
    toolbarVersion: 'toolbar',
    isAuthenticated: false,
    siteApps: [],
}

let client: IPostHog | undefined

beforeEach(() => {
    vi.useFakeTimers()
})
afterEach(async () => {
    await client?.dispose()
    client = undefined
    vi.useRealTimers()
})

describe('feature flags under capture consent denial', () => {
    it('loads flags while opted out without sending capture, and keeps loading after opt-in', async () => {
        const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
            String(input).includes('/flags/')
                ? new Response(JSON.stringify({ flags: { test: { key: 'test', enabled: true } } }))
                : new Response('{}')
        )
        client = await createPostHog({
            projectToken: 'ph_flags_consent',
            capturePageview: false,
            storage: false,
            navigator: false,
            remoteConfig,
            analytics: { flushInterval: 0 },
            flags: { refreshIntervalMs: 0 },
            optOutByDefault: true,
            fetch,
        })
        const flags = client.featureFlags
        if (!flags) throw new Error('Expected feature flags to be installed')
        await vi.advanceTimersByTimeAsync(5)
        expect(flags.getFeatureFlag('test')?.enabled).toBe(true)

        for (let index = 0; index < 3; index++) {
            flags.setPersonPropertiesForFlags({ index })
            await vi.advanceTimersByTimeAsync(1000)
        }
        client.capture('denied')
        await client.flush()
        const paths = fetch.mock.calls.map(([input]) => new URL(String(input)).pathname)
        expect(paths.filter((path) => path !== '/flags/')).toEqual([])

        client.optIn()
        const reload = flags.reloadFeatureFlags()
        await vi.advanceTimersByTimeAsync(5)
        expect(await reload).toEqual({ status: 'loaded' })
        client.capture('granted')
        await client.flush()
        const events = fetch.mock.calls
            .filter(([input]) => new URL(String(input)).pathname !== '/flags/')
            .flatMap(([, init]) => JSON.parse(String(init?.body)).batch)
            .map((event: { event: string }) => event.event)
        expect(events).toEqual(['granted', '$feature_flag_called'])
    })
})

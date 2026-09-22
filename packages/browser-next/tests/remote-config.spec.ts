import { createPostHog as createRoot } from '../src'
import { createPostHog as createCore, type BrowserFetch, type CorePostHogOptions } from '../src/core'
import { localRemoteConfig } from './helpers'

const options: CorePostHogOptions = {
    projectToken: 'ph_test',
    storage: false,
    navigator: false,
    capturePageview: false,
}

const response = () => new Response(JSON.stringify(localRemoteConfig))

// Exercise both published factory graphs, including the buffer-only core.
describe.each([
    ['root', (options: CorePostHogOptions) => createRoot({ ...options, flags: false })],
    ['core', createCore],
] as const)('%s remote configuration', (_, create) => {
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it.each([
        [undefined, 'https://us-assets.i.posthog.com'],
        ...['app', 'us', 'us-assets', 'eu', 'eu-assets'].flatMap((region) =>
            ['', '.i'].map((ingestion): [string, string] => [
                `https://${region}${ingestion}.posthog.com/`,
                `https://${region.startsWith('eu') ? 'eu' : 'us'}-assets.i.posthog.com`,
            ])
        ),
        ['https://EU.I.POSTHOG.COM/', 'https://eu-assets.i.posthog.com'],
        ['https://proxy.example.com', 'https://proxy.example.com'],
        ['https://proxy.example.com/posthog/', 'https://proxy.example.com/posthog'],
        ['https://us.i.posthog.com.example.org', 'https://us.i.posthog.com.example.org'],
    ])('routes the JSON GET through the resolved assets host (%s)', async (apiHost, host) => {
        const fetch = vi.fn(async () => response())
        const posthog = await create({
            ...options,
            ...(apiHost ? { apiHost } : {}),
            fetch,
        })
        await expect(posthog.getRemoteConfig()).resolves.toEqual(localRemoteConfig)
        expect(fetch).toHaveBeenCalledTimes(1)
        const [url, init] = fetch.mock.calls[0] as unknown as Parameters<BrowserFetch>
        expect(String(url)).toBe(`${host}/array/ph_test/config?token=ph_test`)
        expect(init).toMatchObject({ method: 'GET', credentials: 'omit' })
        expect(init?.body).toBeUndefined()
        await posthog.dispose()
    })

    it('uses inline configuration without a request', async () => {
        const fetch = vi.fn(async () => response())
        const posthog = await create({ ...options, fetch, remoteConfig: localRemoteConfig })
        const observed = vi.fn()
        posthog.onRemoteConfig(observed)
        await expect(posthog.getRemoteConfig()).resolves.toBe(localRemoteConfig)
        expect(observed).toHaveBeenCalledWith({ ok: true, config: localRemoteConfig })
        expect(fetch).not.toHaveBeenCalled()
        await posthog.dispose()
    })

    it('shares startup work with concurrent subscribers without awaiting it for capture or setup', async () => {
        let finish!: (response: Response) => void
        const fetch = vi.fn(
            () =>
                new Promise<Response>((resolve) => {
                    finish = resolve
                })
        )
        const first = vi.fn()
        const second = vi.fn()
        const posthog = await create({
            ...options,
            fetch,
            extensions: [
                {
                    name: 'subscriber',
                    setup(client) {
                        client.onRemoteConfig(first)
                        client.capture('setup')
                    },
                },
            ],
        })
        posthog.onRemoteConfig(second)
        posthog.capture('before config')
        expect(posthog.session!.sessionId).not.toBe('')
        const pending = posthog.getRemoteConfig()
        expect(fetch).toHaveBeenCalledTimes(1)
        finish(response())
        await expect(pending).resolves.toEqual(localRemoteConfig)
        expect(first.mock.calls).toEqual([[{ ok: true, config: localRemoteConfig }]])
        expect(second.mock.calls).toEqual(first.mock.calls)
        await posthog.getRemoteConfig()
        expect(fetch).toHaveBeenCalledTimes(1)
        // Do not flush buffered analytics into the pending-response transport.
        posthog.optOut()
        await posthog.dispose()
    })

    it('loads and publishes under denial while extension requests remain gated', async () => {
        const fetch = vi.fn(async () => response())
        const observed = vi.fn()
        const posthog = await create({
            ...options,
            fetch,
            optOutByDefault: true,
            extensions: [
                {
                    name: 'subscriber',
                    setup(client) {
                        client.onRemoteConfig(observed)
                    },
                },
            ],
        })
        await posthog.getRemoteConfig()
        expect(observed).toHaveBeenCalledWith({ ok: true, config: localRemoteConfig })
        expect((await posthog.sendRequest('/flags/')).statusCode).toBe(0)
        expect(fetch).toHaveBeenCalledTimes(1)
        await posthog.dispose()
    })

    it('blocks automatic remote-config fetching for bots', async () => {
        const fetch = vi.fn(async () => response())
        const posthog = await create({
            ...options,
            navigator: { userAgent: 'Googlebot/2.1' },
            fetch,
        })
        await expect(posthog.getRemoteConfig()).resolves.toBeUndefined()
        expect(fetch).not.toHaveBeenCalled()
        await posthog.dispose()
    })

    it.each([
        ['server failure', () => new Response('{}', { status: 500 })],
        ['malformed JSON', () => new Response('{')],
        ['empty body', () => new Response('')],
        ['null', () => new Response('null')],
        ['array', () => new Response('[]')],
        ['primitive', () => new Response('true')],
        [
            'network rejection',
            () => {
                throw new Error('offline')
            },
        ],
    ])('publishes one retained failure for %s', async (_, makeResponse) => {
        const fetch = vi.fn(async () => makeResponse())
        const observed = vi.fn()
        const posthog = await create({ ...options, fetch })
        posthog.onRemoteConfig(observed)
        await expect(posthog.getRemoteConfig()).resolves.toBeUndefined()
        await posthog.getRemoteConfig()
        expect(observed.mock.calls).toEqual([[{ ok: false }]])
        const late = vi.fn()
        posthog.onRemoteConfig(late)
        expect(late.mock.calls).toEqual([[{ ok: false }]])
        expect(fetch).toHaveBeenCalledTimes(1)
        await posthog.dispose()
    })

    it.each([false, undefined] as const)('settles unavailable Fetch (%s) as failure', async (fetch) => {
        vi.stubGlobal('fetch', undefined)
        const posthog = await create({ ...options, ...(fetch === false ? { fetch } : {}) })
        await expect(posthog.getRemoteConfig()).resolves.toBeUndefined()
        const observed = vi.fn()
        posthog.onRemoteConfig(observed)
        expect(observed).toHaveBeenCalledWith({ ok: false })
        await posthog.dispose()
    })

    it.each(['timeout', 'shutdown', 'timeout without AbortController'])(
        'bounds %s and ignores late responses',
        async (mode) => {
            vi.useFakeTimers()
            if (mode === 'timeout without AbortController') vi.stubGlobal('AbortController', undefined)
            let finish!: (response: Response) => void
            const fetch = vi.fn<Parameters<BrowserFetch>, ReturnType<BrowserFetch>>(
                () =>
                    new Promise((resolve) => {
                        finish = resolve
                    })
            )
            const posthog = await create({ ...options, fetch, remoteConfigTimeoutMs: 10 })
            const observed = vi.fn()
            posthog.onRemoteConfig(observed)
            const pending = posthog.getRemoteConfig()
            if (mode === 'shutdown') await posthog.dispose()
            else await vi.advanceTimersByTimeAsync(10)
            await expect(pending).resolves.toBeUndefined()
            expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(
                mode === 'timeout without AbortController' ? undefined : true
            )
            expect(observed.mock.calls).toEqual(mode === 'shutdown' ? [] : [[{ ok: false }]])
            finish(response())
            await vi.advanceTimersByTimeAsync(0)
            expect(observed.mock.calls).toEqual(mode === 'shutdown' ? [] : [[{ ok: false }]])
            await posthog.dispose()
            expect(vi.getTimerCount()).toBe(0)
            await posthog.getRemoteConfig()
            expect(fetch).toHaveBeenCalledTimes(1)
        }
    )
})

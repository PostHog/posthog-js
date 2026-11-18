import { createPostHog as createCore } from '../src/composition/npm/core'
import { createPostHog as createRoot } from '../src/composition/npm'
import type { CorePostHogOptions, IPostHog, NewSessionInfo, StorageLike } from '../src/core/types'
import { tracingHeaders, type TracingHeadersOptions } from '../src/products/tracing-headers/tracing-headers'

const START = new Date('2026-01-01T00:00:00.000Z').getTime()
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/

class FakeXHR {
    readonly headers: [string, string][] = []
    open(_method: string, _url: string | URL): void {
        this.headers.length = 0
    }
    setRequestHeader(name: string, value: string): void {
        this.headers.push([name, value])
    }
    send(): void {}
    header(name: string): string | undefined {
        const values = this.headers.filter(([key]) => key.toLowerCase() === name.toLowerCase())
        return values.length ? values.map(([, value]) => value).join(', ') : undefined
    }
}

const xhrMethods = { ...Object.getOwnPropertyDescriptors(FakeXHR.prototype) }
const clients: IPostHog[] = []
let downstream: ReturnType<typeof vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>>
let browser: Window & typeof globalThis

const options = (extra: Partial<CorePostHogOptions> = {}): CorePostHogOptions => ({
    projectToken: 'ph_tracing',
    storage: false,
    fetch: false,
    navigator: false,
    capturePageview: false,
    remoteConfig: {
        supportedCompression: [],
        toolbarParams: {},
        toolbarVersion: 'toolbar',
        isAuthenticated: false,
        siteApps: [],
    },
    ...extra,
})

const create = async (
    config: TracingHeadersOptions = { hostnames: ['api.example.com'] },
    extra: Partial<CorePostHogOptions> = {}
): Promise<IPostHog> => {
    const client = await createCore(options({ ...extra, extensions: [tracingHeaders(config)] }))
    clients.push(client)
    return client
}

const sentHeaders = (index = 0): Headers => {
    const [input, init] = downstream.mock.calls[index] as [RequestInfo | URL, RequestInit | undefined]
    return new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
}

beforeEach(() => {
    vi.useFakeTimers({ now: START, toFake: ['Date'] })
    downstream = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(() => Promise.resolve(new Response('ok')))
    browser = {
        location: { href: 'https://app.example.com/page', origin: 'https://app.example.com' },
        fetch: downstream,
        crypto: globalThis.crypto,
        XMLHttpRequest: FakeXHR,
    } as unknown as Window & typeof globalThis
    vi.stubGlobal('window', browser)
})

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    Object.defineProperties(FakeXHR.prototype, xhrMethods)
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe('tracing headers', () => {
    it('adds session, window and distinct id headers to fetch requests for configured hostnames', async () => {
        const client = await create({ hostnames: [' API.Example.com '] })
        await browser.fetch('https://api.example.com/work', { method: 'POST', body: 'body' })
        await browser.fetch(new Request('https://api.example.com:8443/work'))

        const session = client.session!
        for (const index of [0, 1]) {
            expect(Object.fromEntries(sentHeaders(index))).toEqual({
                'x-posthog-distinct-id': client.distinctId,
                'x-posthog-session-id': session.sessionId,
                'x-posthog-window-id': session.windowId,
            })
        }
        expect(downstream.mock.calls[0]![1]).toMatchObject({ method: 'POST', body: 'body' })
    })

    it.each(['https://other.example/work', 'https://sub.api.example.com/work', '/relative'])(
        'leaves requests to %s untouched',
        async (url) => {
            await create()
            const init = { headers: { 'X-Custom': 'kept' } }
            await browser.fetch(url, init)
            expect(downstream).toHaveBeenCalledWith(url, init)
        }
    )

    it('overwrites stale tracing headers without mutating the caller headers', async () => {
        const client = await create()
        const headers = new Headers({ 'X-POSTHOG-DISTINCT-ID': 'stale', 'X-Custom': 'kept' })
        await browser.fetch('https://api.example.com/work', { headers })
        expect(sentHeaders().get('X-POSTHOG-DISTINCT-ID')).toBe(client.distinctId)
        expect(sentHeaders().get('X-Custom')).toBe('kept')
        expect(headers.get('X-POSTHOG-DISTINCT-ID')).toBe('stale')
    })

    it('reads identity at request time without capturing events or extending the session', async () => {
        const client = await create()
        client.capture('start')
        const session = client.session!
        const events = vi.fn()
        client.onEvent(events)
        vi.setSystemTime(START + 60_000)

        await browser.fetch('https://api.example.com/work')
        expect(client.session).toEqual(session)

        client.identify('user-123')
        events.mockClear()
        await browser.fetch('https://api.example.com/work')
        expect(sentHeaders(1).get('X-POSTHOG-DISTINCT-ID')).toBe('user-123')
        expect(sentHeaders(1).get('X-POSTHOG-SESSION-ID')).toBe(session.sessionId)
        expect(events).not.toHaveBeenCalled()
    })

    it('starts a session when none exists, as capture would', async () => {
        const client = await create()
        expect(client.session).toBeUndefined()
        await browser.fetch('https://api.example.com/work')
        const session = client.session!
        expect(sentHeaders().get('X-POSTHOG-SESSION-ID')).toBe(session.sessionId)

        client.capture('after')
        expect(client.session?.sessionId).toBe(session.sessionId)
    })

    it('starts a new session after reset and announces it', async () => {
        const client = await create()
        client.capture('before reset')
        const previous = client.session!
        const sessions: NewSessionInfo[] = []
        client.onNewSession((session) => sessions.push(session))

        client.reset()
        await browser.fetch('https://api.example.com/work')

        const session = client.session!
        expect(session.sessionId).not.toBe(previous.sessionId)
        expect(sentHeaders().get('X-POSTHOG-SESSION-ID')).toBe(session.sessionId)
        expect(sentHeaders().get('X-POSTHOG-DISTINCT-ID')).toBe(client.distinctId)
        expect(sessions).toEqual([expect.objectContaining({ sessionId: session.sessionId, reason: 'reset' })])
    })

    describe('with a persisted session', () => {
        const storage = () => {
            const values = new Map<string, string>()
            return {
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => void values.set(key, value),
                removeItem: (key: string) => void values.delete(key),
            }
        }
        const persistedSession = async (shared: StorageLike) => {
            const previous = await createCore(options({ storage: shared }))
            previous.capture('previous page')
            const session = previous.session!
            await previous.dispose()
            return session
        }

        it('sends an active session without extending it', async () => {
            const shared = storage()
            const previous = await persistedSession(shared)
            vi.setSystemTime(START + 10 * 60_000)
            await create(undefined, { storage: shared })
            await browser.fetch('https://api.example.com/work')
            expect(sentHeaders().get('X-POSTHOG-SESSION-ID')).toBe(previous.sessionId)

            vi.setSystemTime(START + 35 * 60_000)
            const next = await createCore(options({ storage: shared }))
            clients.push(next)
            next.capture('next page')
            expect(next.session?.sessionId).not.toBe(previous.sessionId)
        })

        it('sends an idle session without rotating it', async () => {
            const shared = storage()
            const previous = await persistedSession(shared)
            vi.setSystemTime(START + 3 * 60 * 60_000)
            const client = await create(undefined, { storage: shared })
            const sessions = vi.fn()
            client.onNewSession(sessions)

            await browser.fetch('https://api.example.com/work')

            expect(sentHeaders().get('X-POSTHOG-SESSION-ID')).toBe(previous.sessionId)
            expect(sessions).not.toHaveBeenCalled()
            client.capture('next event')
            expect(sessions).toHaveBeenCalledWith(expect.objectContaining({ reason: 'idleTimeout' }))
        })

        it('starts a new session once the persisted one reaches its maximum length', async () => {
            const shared = storage()
            const previous = await persistedSession(shared)
            vi.setSystemTime(START + 25 * 60 * 60_000)
            const client = await create(undefined, { storage: shared })
            await browser.fetch('https://api.example.com/work')
            expect(sentHeaders().get('X-POSTHOG-SESSION-ID')).not.toBe(previous.sessionId)
            expect(sentHeaders().get('X-POSTHOG-SESSION-ID')).toBe(client.session?.sessionId)
        })

        it('follows a session started in another tab without a capture in this one', async () => {
            const shared = storage()
            const client = await create(undefined, { storage: shared })
            client.capture('this tab')
            const sibling = await createCore(options({ storage: shared }))
            clients.push(sibling)
            sibling.reset()
            sibling.capture('other tab')

            await browser.fetch('https://api.example.com/work')

            expect(sentHeaders().get('X-POSTHOG-SESSION-ID')).toBe(sibling.session?.sessionId)
            expect(sentHeaders().get('X-POSTHOG-WINDOW-ID')).toBe(client.session?.windowId)
        })
    })

    it('omits PostHog headers while capture is not permitted and keeps trace propagation', async () => {
        const client = await create(
            { hostnames: ['api.example.com'], tracePropagationTargets: ['api.example.com'] },
            { optOutByDefault: true }
        )
        await browser.fetch('https://api.example.com/work')
        expect([...sentHeaders().keys()]).toEqual(['traceparent'])
        expect(client.session).toBeUndefined()

        client.optIn()
        await browser.fetch('https://api.example.com/work')
        expect(sentHeaders(1).get('X-POSTHOG-DISTINCT-ID')).toBe(client.distinctId)
    })

    it('adds a new traceparent to propagation targets only and keeps an existing one', async () => {
        await create({ tracePropagationTargets: ['https://api.example.com', 'internal.example.com'] })
        await browser.fetch('https://api.example.com/work')
        await browser.fetch('https://api.example.com/work')
        await browser.fetch('http://internal.example.com:8080/work')
        await browser.fetch('http://api.example.com/work')
        await browser.fetch('https://api.example.com/work', { headers: { traceparent: 'app' } })

        expect(sentHeaders(0).get('traceparent')).toMatch(TRACEPARENT)
        expect(sentHeaders(1).get('traceparent')).not.toBe(sentHeaders(0).get('traceparent'))
        expect(sentHeaders(2).get('traceparent')).toMatch(TRACEPARENT)
        expect(sentHeaders(3).has('traceparent')).toBe(false)
        expect(sentHeaders(4).get('traceparent')).toBe('app')
        expect(sentHeaders(0).has('X-POSTHOG-DISTINCT-ID')).toBe(false)
    })

    it('adds headers to XMLHttpRequest after open and traceparent on send', async () => {
        const client = await create({ hostnames: ['api.example.com'], tracePropagationTargets: ['api.example.com'] })
        const matched = new browser.XMLHttpRequest() as unknown as FakeXHR
        matched.open('GET', 'https://api.example.com/work')
        expect(matched.header('X-POSTHOG-DISTINCT-ID')).toBe(client.distinctId)
        expect(matched.header('X-POSTHOG-SESSION-ID')).toBe(client.session!.sessionId)
        expect(matched.header('traceparent')).toBeUndefined()
        matched.send()
        expect(matched.header('traceparent')).toMatch(TRACEPARENT)

        const unmatched = new browser.XMLHttpRequest() as unknown as FakeXHR
        unmatched.open('GET', 'https://other.example/work')
        unmatched.send()
        expect(unmatched.headers).toEqual([])
    })

    it('does not break XMLHttpRequest when identity cannot be read', async () => {
        const client = await create()
        vi.spyOn(client, 'distinctId', 'get').mockImplementation(() => {
            throw new Error('unavailable')
        })
        vi.spyOn(client.logger, 'error').mockImplementation(() => {})
        const request = new browser.XMLHttpRequest() as unknown as FakeXHR
        expect(() => request.open('GET', 'https://api.example.com/work')).not.toThrow()
        expect(request.header('X-POSTHOG-DISTINCT-ID')).toBeUndefined()
        expect(request.header('X-POSTHOG-SESSION-ID')).toBeDefined()
    })

    it('restores fetch and XMLHttpRequest when the client is disposed', async () => {
        const client = await create({ hostnames: ['api.example.com'], tracePropagationTargets: ['api.example.com'] })
        expect(browser.fetch).not.toBe(downstream)
        expect(FakeXHR.prototype.open).not.toBe(xhrMethods.open!.value)
        await client.dispose()
        expect(browser.fetch).toBe(downstream)
        for (const method of ['open', 'setRequestHeader', 'send'] as const) {
            expect(FakeXHR.prototype[method]).toBe(xhrMethods[method]!.value)
        }
    })

    it('does not patch anything without hostnames or propagation targets', async () => {
        await create({ hostnames: [' '], tracePropagationTargets: [] })
        expect(browser.fetch).toBe(downstream)
        expect(FakeXHR.prototype.open).toBe(xhrMethods.open!.value)
    })
})

describe('tracing headers composition', () => {
    it('installs tracing headers from the root entry before the client resolves', async () => {
        const client = await createRoot({
            ...options(),
            flags: false,
            logs: false,
            surveys: false,
            autocapture: false,
            tracingHeaders: { hostnames: ['api.example.com'] },
        })
        clients.push(client)
        await browser.fetch('https://api.example.com/work')
        expect(sentHeaders().get('X-POSTHOG-DISTINCT-ID')).toBe(client.distinctId)
        expect(client.getExtension('tracingHeaders')).toBeDefined()
    })

    it('snapshots the configuration when the client is created', async () => {
        const hostnames = ['api.example.com']
        const client = await createRoot({
            ...options(),
            flags: false,
            logs: false,
            surveys: false,
            autocapture: false,
            tracingHeaders: { hostnames },
        })
        clients.push(client)
        hostnames[0] = 'other.example'
        await client.resolveExtension('tracingHeaders')
        await browser.fetch('https://api.example.com/work')
        expect(sentHeaders().get('X-POSTHOG-DISTINCT-ID')).toBe(client.distinctId)
    })

    it.each<TracingHeadersOptions | undefined>([undefined, {}, { hostnames: [' '], tracePropagationTargets: [] }])(
        'does not load tracing headers for %j',
        async (tracingHeaders) => {
            const client = await createRoot({
                ...options(),
                flags: false,
                logs: false,
                surveys: false,
                autocapture: false,
                ...(tracingHeaders ? { tracingHeaders } : {}),
            })
            clients.push(client)
            expect(await client.resolveExtension('tracingHeaders')).toBeUndefined()
            expect(browser.fetch).toBe(downstream)
        }
    )
})

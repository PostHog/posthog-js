import { createPostHog as createCore } from '../src/composition/npm/core'
import { createPostHog as createRoot } from '../src/composition/npm'
import type { CorePostHogOptions, IPostHog, StorageLike } from '../src/core/types'
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
        client.capture('start')
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

    it('sends no session header and starts no session before the first capture', async () => {
        const client = await create()
        const sessions = vi.fn()
        client.onSessionId(sessions)

        await browser.fetch('https://api.example.com/work')

        expect(Object.fromEntries(sentHeaders())).toEqual({ 'x-posthog-distinct-id': client.distinctId })
        expect(client.session).toBeUndefined()
        expect(sessions).not.toHaveBeenCalled()
        client.capture('after')
        expect(sessions).toHaveBeenCalledTimes(1)
    })

    it('sends no session header after reset and leaves the new session to the next capture', async () => {
        const client = await create()
        client.capture('before reset')
        const newSessions = vi.fn()
        client.onNewSession(newSessions)
        const sessionIds = vi.fn()
        client.onSessionId(sessionIds)
        sessionIds.mockClear()

        client.reset()
        await browser.fetch('https://api.example.com/work')

        expect(Object.fromEntries(sentHeaders())).toEqual({ 'x-posthog-distinct-id': client.distinctId })
        expect(client.session).toBeUndefined()
        expect(newSessions).not.toHaveBeenCalled()
        expect(sessionIds).not.toHaveBeenCalled()
        client.capture('after reset')
        expect(newSessions).toHaveBeenCalledWith(expect.objectContaining({ reason: 'reset' }))
    })

    it('neither sends nor rotates a session past its maximum length', async () => {
        const client = await create()
        client.capture('start')
        const session = client.session!
        for (let elapsed = 20 * 60_000; elapsed <= 24 * 60 * 60_000; elapsed += 20 * 60_000) {
            vi.setSystemTime(START + elapsed)
            client.capture('activity')
        }
        vi.setSystemTime(START + 24 * 60 * 60_000 + 60_000)
        const sessions = vi.fn()
        client.onNewSession(sessions)

        await browser.fetch('https://api.example.com/work')

        expect(sentHeaders().has('X-POSTHOG-SESSION-ID')).toBe(false)
        expect(client.session?.sessionId).toBe(session.sessionId)
        expect(sessions).not.toHaveBeenCalled()
        client.capture('next event')
        expect(sessions).toHaveBeenCalledWith(expect.objectContaining({ reason: 'maxLength' }))
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
        const sibling = async (shared: StorageLike): Promise<IPostHog> => {
            const client = await createCore(options({ storage: shared }))
            clients.push(client)
            return client
        }
        const sessionIdAt = (ms: number, digit: string): string => {
            const hex = ms.toString(16).padStart(12, '0')
            return `${hex.slice(0, 8)}-${hex.slice(8)}-7123-8456-${digit.repeat(12)}`
        }

        it('sends an active session without extending it', async () => {
            const shared = storage()
            const previous = await persistedSession(shared)
            vi.setSystemTime(START + 10 * 60_000)
            await create(undefined, { storage: shared })
            await browser.fetch('https://api.example.com/work')
            expect(sentHeaders().get('X-POSTHOG-SESSION-ID')).toBe(previous.sessionId)
            expect(sentHeaders().has('X-POSTHOG-WINDOW-ID')).toBe(false)

            vi.setSystemTime(START + 35 * 60_000)
            const next = await sibling(shared)
            next.capture('next page')
            expect(next.session?.sessionId).not.toBe(previous.sessionId)
        })

        it('does not notify session ID listeners when a request reads the session on a new page', async () => {
            const shared = storage()
            await persistedSession(shared)
            const client = await create(undefined, { storage: shared })
            const sessions = vi.fn()
            client.onSessionId(sessions)

            await browser.fetch('https://api.example.com/work')
            expect(sessions).not.toHaveBeenCalled()

            client.capture('next event')
            expect(sessions).toHaveBeenCalledTimes(1)
        })

        it('neither sends nor rotates an idle session', async () => {
            const shared = storage()
            await persistedSession(shared)
            vi.setSystemTime(START + 3 * 60 * 60_000)
            const client = await create(undefined, { storage: shared })
            const sessions = vi.fn()
            client.onNewSession(sessions)

            await browser.fetch('https://api.example.com/work')

            expect(sentHeaders().has('X-POSTHOG-SESSION-ID')).toBe(false)
            expect(client.session).toBeUndefined()
            expect(sessions).not.toHaveBeenCalled()
            client.capture('next event')
            expect(sessions).toHaveBeenCalledWith(expect.objectContaining({ reason: 'idleTimeout' }))
        })

        it('sends a pending bootstrap session instead of a different persisted one, without committing it', async () => {
            const shared = storage()
            const previous = await persistedSession(shared)
            const bootstrapped = sessionIdAt(START, '3')
            vi.setSystemTime(START + 10 * 60_000)
            const client = await create(undefined, { storage: shared, bootstrap: { sessionId: bootstrapped } })
            const sessions: string[] = []
            client.onSessionId((session) => sessions.push(session.sessionId))

            await browser.fetch('https://api.example.com/work')

            expect(bootstrapped).not.toBe(previous.sessionId)
            expect(sentHeaders().get('X-POSTHOG-SESSION-ID')).toBe(bootstrapped)
            expect(sentHeaders().has('X-POSTHOG-WINDOW-ID')).toBe(false)
            expect(client.session).toBeUndefined()
            client.capture('first event')
            expect(sessions).toEqual([bootstrapped])
        })

        it('follows a session started in another tab without a capture in this one', async () => {
            const shared = storage()
            const client = await create(undefined, { storage: shared })
            client.capture('this tab')
            const other = await sibling(shared)
            other.reset()
            other.capture('other tab')

            await browser.fetch('https://api.example.com/work')

            expect(sentHeaders().get('X-POSTHOG-SESSION-ID')).toBe(other.session?.sessionId)
            expect(sentHeaders().get('X-POSTHOG-WINDOW-ID')).toBe(client.session?.windowId)
        })

        it.each([
            ['fetch(url, init)', (headers: HeadersInit) => browser.fetch('https://api.example.com/work', { headers })],
            [
                'fetch(Request)',
                (headers: HeadersInit) => browser.fetch(new Request('https://api.example.com/work', { headers })),
            ],
        ])('does not pair a caller window header with the SDK session through %s', async (_, send) => {
            const shared = storage()
            const previous = await persistedSession(shared)
            await create(undefined, { storage: shared })

            await send({ 'X-POSTHOG-WINDOW-ID': 'stale-window' })

            expect({
                session: sentHeaders().get('X-POSTHOG-SESSION-ID'),
                window: sentHeaders().get('X-POSTHOG-WINDOW-ID'),
            }).toEqual({ session: previous.sessionId, window: null })
        })

        describe('sends the session the next capture uses', () => {
            const scenarios: { name: string; setup: () => Promise<IPostHog>; sendsSession: boolean }[] = [
                { name: 'fresh visitor', setup: () => create(undefined, { storage: storage() }), sendsSession: false },
                {
                    name: 'persisted active session',
                    setup: async () => {
                        const shared = storage()
                        await persistedSession(shared)
                        vi.setSystemTime(START + 29 * 60_000)
                        return create(undefined, { storage: shared })
                    },
                    sendsSession: true,
                },
                {
                    name: 'persisted idle session',
                    setup: async () => {
                        const shared = storage()
                        await persistedSession(shared)
                        vi.setSystemTime(START + 30 * 60_000 + 1)
                        return create(undefined, { storage: shared })
                    },
                    sendsSession: false,
                },
                {
                    name: 'pending reset in this tab',
                    setup: async () => {
                        const client = await create(undefined, { storage: storage() })
                        client.capture('start')
                        client.reset()
                        return client
                    },
                    sendsSession: false,
                },
                {
                    name: 'fresh visitor with a bootstrap session',
                    setup: () =>
                        create(undefined, {
                            storage: storage(),
                            bootstrap: { sessionId: sessionIdAt(START - 1000, '1') },
                        }),
                    sendsSession: true,
                },
                {
                    name: 'bootstrap session equal to the persisted session',
                    setup: async () => {
                        const shared = storage()
                        const bootstrap = { sessionId: sessionIdAt(START, '2') }
                        const first = await createCore(options({ storage: shared, bootstrap }))
                        first.capture('first page')
                        await first.dispose()
                        vi.setSystemTime(START + 60_000)
                        return create(undefined, { storage: shared, bootstrap })
                    },
                    sendsSession: true,
                },
                {
                    name: 'reset in another tab without a capture',
                    setup: async () => {
                        const shared = storage()
                        const client = await create(undefined, { storage: shared })
                        client.capture('this tab')
                        ;(await sibling(shared)).reset()
                        return client
                    },
                    sendsSession: false,
                },
                {
                    name: 'new session started in another tab',
                    setup: async () => {
                        const shared = storage()
                        const client = await create(undefined, { storage: shared })
                        client.capture('this tab')
                        const other = await sibling(shared)
                        other.reset()
                        other.capture('other tab')
                        return client
                    },
                    sendsSession: true,
                },
            ]

            it.each(scenarios)('$name', async ({ setup, sendsSession }) => {
                const client = await setup()
                await browser.fetch('https://api.example.com/work')
                const sessionHeader = sentHeaders().get('X-POSTHOG-SESSION-ID')
                const windowHeader = sentHeaders().get('X-POSTHOG-WINDOW-ID')

                client.capture('next event')

                const next = client.session!
                expect({ session: sessionHeader, window: windowHeader }).toEqual({
                    session: sendsSession ? next.sessionId : null,
                    window: windowHeader === null ? null : next.windowId,
                })
            })
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
        client.capture('start')
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

    it('sends XMLHttpRequest without PostHog headers when identity cannot be read', async () => {
        const client = await create({ hostnames: ['api.example.com'], tracePropagationTargets: ['api.example.com'] })
        client.capture('start')
        vi.spyOn(client, 'distinctId', 'get').mockImplementation(() => {
            throw new Error('unavailable')
        })
        vi.spyOn(client.logger, 'error').mockImplementation(() => {})
        const request = new browser.XMLHttpRequest() as unknown as FakeXHR
        expect(() => request.open('GET', 'https://api.example.com/work')).not.toThrow()
        expect(request.headers).toEqual([])
        request.send()
        expect(request.header('traceparent')).toMatch(TRACEPARENT)
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

    it('stops adding headers after disposal when a later wrapper still calls the PostHog wrapper', async () => {
        const client = await create({ hostnames: ['api.example.com'], tracePropagationTargets: ['api.example.com'] })
        const installed = browser.fetch
        const outer = (input: RequestInfo | URL, init?: RequestInit) => installed(input, init)
        browser.fetch = outer
        const { open, send } = FakeXHR.prototype
        FakeXHR.prototype.open = function (this: FakeXHR, method: string, url: string | URL) {
            open.call(this, method, url)
        }
        FakeXHR.prototype.send = function (this: FakeXHR) {
            send.call(this)
        }

        await client.dispose()
        await browser.fetch('https://api.example.com/work')
        const request = new browser.XMLHttpRequest() as unknown as FakeXHR
        request.open('GET', 'https://api.example.com/work')
        request.send()

        expect(browser.fetch).toBe(outer)
        expect([...sentHeaders().keys()]).toEqual([])
        expect(request.headers).toEqual([])
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

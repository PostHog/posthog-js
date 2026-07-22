const mockCapture = jest.fn()
const mockWithContext = jest.fn((_, fn) => fn())
const mockEnterContext = jest.fn()

jest.mock('posthog-node', () => ({
    PostHog: jest.fn().mockImplementation(() => ({
        capture: mockCapture,
        withContext: mockWithContext,
        enterContext: mockEnterContext,
    })),
}))

function createMockCookies(entries: Record<string, string>) {
    return {
        get: jest.fn((name: string) => {
            const value = entries[name]
            return value !== undefined ? { name, value } : undefined
        }),
        getAll: jest.fn(() => Object.entries(entries).map(([name, value]) => ({ name, value }))),
        has: jest.fn((name: string) => name in entries),
    }
}

function createMockHeaders(entries: Record<string, string>) {
    return {
        get: jest.fn((name: string) => entries[name.toLowerCase()] ?? null),
    }
}

jest.mock('next/headers.js', () => ({
    cookies: jest.fn(() => Promise.resolve(createMockCookies({}))),
    headers: jest.fn(() => Promise.resolve(createMockHeaders({}))),
}))

// Mock clientCache.node to avoid cross-test cache pollution
const mockGetOrCreateNodeClient = jest.fn().mockImplementation(() => ({
    capture: mockCapture,
    withContext: mockWithContext,
    enterContext: mockEnterContext,
}))

jest.mock('../src/server/clientCache.node', () => ({
    getOrCreateNodeClient: (...args: unknown[]) => mockGetOrCreateNodeClient(...args),
}))

import { createPostHog } from '../src/server/createPostHog'
import { createPostHog as createPagesPostHog } from '../src/pages/createPostHog'
import { cookies, headers } from 'next/headers.js'

describe('createPostHog', () => {
    const originalEnv = process.env

    beforeEach(() => {
        jest.clearAllMocks()
        process.env = { ...originalEnv }
        process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_env_key'
        ;(cookies as jest.Mock).mockResolvedValue(createMockCookies({}))
        ;(headers as jest.Mock).mockResolvedValue(createMockHeaders({}))
    })

    afterAll(() => {
        process.env = originalEnv
    })

    it('passes apiKey and options from config to the node client', async () => {
        const { getPostHog } = createPostHog({
            apiKey: 'phc_test123',
            options: { host: 'https://custom.posthog.com' },
        })

        await getPostHog()

        expect(mockGetOrCreateNodeClient).toHaveBeenCalledWith('phc_test123', {
            host: 'https://custom.posthog.com',
        })
    })

    it('behaves like getPostHog when no getDistinctId is configured', async () => {
        ;(cookies as jest.Mock).mockResolvedValue(
            createMockCookies({
                ph_phc_test123_posthog: JSON.stringify({ distinct_id: 'cookie-user' }),
            })
        )

        const { getPostHog } = createPostHog({ apiKey: 'phc_test123' })
        const client = await getPostHog()
        client.capture({ event: 'test_event' })

        expect(mockWithContext).toHaveBeenCalledWith(
            expect.objectContaining({ distinctId: 'cookie-user' }),
            expect.any(Function)
        )
    })

    describe('getDistinctId resolver', () => {
        it('server-resolved distinct id overrides cookie identity', async () => {
            ;(cookies as jest.Mock).mockResolvedValue(
                createMockCookies({
                    ph_phc_test123_posthog: JSON.stringify({
                        distinct_id: 'cookie-user',
                        $device_id: 'device_xyz',
                        $sesid: [1708700000000, 'cookie-session', 1708700000000],
                    }),
                })
            )

            const { getPostHog } = createPostHog({
                apiKey: 'phc_test123',
                getDistinctId: async () => 'server-user',
            })
            const client = await getPostHog()
            client.capture({ event: 'test_event' })

            expect(mockWithContext).toHaveBeenCalledWith(
                {
                    distinctId: 'server-user',
                    sessionId: 'cookie-session',
                    properties: { $session_id: 'cookie-session', $device_id: 'device_xyz' },
                },
                expect.any(Function)
            )
        })

        it('server-resolved distinct id overrides tracing headers', async () => {
            ;(headers as jest.Mock).mockResolvedValue(
                createMockHeaders({
                    'x-posthog-distinct-id': 'header-user',
                    'x-posthog-session-id': 'header-session',
                })
            )

            const { getPostHog } = createPostHog({
                apiKey: 'phc_test123',
                getDistinctId: () => 'server-user',
            })
            const client = await getPostHog()
            client.capture({ event: 'test_event' })

            expect(mockWithContext).toHaveBeenCalledWith(
                expect.objectContaining({ distinctId: 'server-user', sessionId: 'header-session' }),
                expect.any(Function)
            )
        })

        it('sets identity when no client identity exists at all', async () => {
            const { getPostHog } = createPostHog({
                apiKey: 'phc_test123',
                getDistinctId: async () => 'server-user',
            })
            const client = await getPostHog()
            client.capture({ event: 'test_event' })

            expect(mockWithContext).toHaveBeenCalledWith(
                { distinctId: 'server-user', sessionId: undefined, properties: undefined },
                expect.any(Function)
            )
        })

        it.each([null, undefined, '', '   '])(
            'falls back to client identity when the resolver returns %p',
            async (resolved) => {
                ;(cookies as jest.Mock).mockResolvedValue(
                    createMockCookies({
                        ph_phc_test123_posthog: JSON.stringify({ distinct_id: 'cookie-user' }),
                    })
                )

                const { getPostHog } = createPostHog({
                    apiKey: 'phc_test123',
                    getDistinctId: async () => resolved,
                })
                const client = await getPostHog()
                client.capture({ event: 'test_event' })

                expect(mockWithContext).toHaveBeenCalledWith(
                    expect.objectContaining({ distinctId: 'cookie-user' }),
                    expect.any(Function)
                )
            }
        )

        it('warns and falls back to client identity when the resolver throws', async () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
            ;(cookies as jest.Mock).mockResolvedValue(
                createMockCookies({
                    ph_phc_test123_posthog: JSON.stringify({ distinct_id: 'cookie-user' }),
                })
            )

            const { getPostHog } = createPostHog({
                apiKey: 'phc_test123',
                getDistinctId: async () => {
                    throw new Error('auth unavailable')
                },
            })
            const client = await getPostHog()
            client.capture({ event: 'test_event' })

            expect(mockWithContext).toHaveBeenCalledWith(
                expect.objectContaining({ distinctId: 'cookie-user' }),
                expect.any(Function)
            )
            expect(warnSpy).toHaveBeenCalledWith(
                '[PostHog Next.js] getDistinctId threw — falling back to client-provided identity',
                expect.any(Error)
            )
            warnSpy.mockRestore()
        })

        it.each([
            'NEXT_REDIRECT;replace;/login;307;',
            'NEXT_NOT_FOUND',
            'NEXT_HTTP_ERROR_FALLBACK;404',
            'DYNAMIC_SERVER_USAGE',
            'BAILOUT_TO_CLIENT_SIDE_RENDERING',
        ])('rethrows Next.js control-flow errors with digest %s', async (digest) => {
            const { getPostHog } = createPostHog({
                apiKey: 'phc_test123',
                getDistinctId: async () => {
                    throw Object.assign(new Error(digest), { digest })
                },
            })

            await expect(getPostHog()).rejects.toMatchObject({ digest })
        })

        it('converts a numeric distinct id to a string with a warning', async () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

            const { getPostHog } = createPostHog({
                apiKey: 'phc_test123',
                getDistinctId: () => 42 as unknown as string,
            })
            const client = await getPostHog()
            client.capture({ event: 'test_event' })

            expect(mockWithContext).toHaveBeenCalledWith(
                expect.objectContaining({ distinctId: '42' }),
                expect.any(Function)
            )
            expect(warnSpy).toHaveBeenCalledWith(
                '[PostHog Next.js] getDistinctId returned a number, but it should be a string. It has been converted to a string.'
            )
            warnSpy.mockRestore()
        })

        it('warns and falls back to client identity when the resolver returns a non-string object', async () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
            ;(cookies as jest.Mock).mockResolvedValue(
                createMockCookies({
                    ph_phc_test123_posthog: JSON.stringify({ distinct_id: 'cookie-user' }),
                })
            )

            const { getPostHog } = createPostHog({
                apiKey: 'phc_test123',
                getDistinctId: () => ({ id: 'user' }) as unknown as string,
            })
            const client = await getPostHog()
            client.capture({ event: 'test_event' })

            expect(mockWithContext).toHaveBeenCalledWith(
                expect.objectContaining({ distinctId: 'cookie-user' }),
                expect.any(Function)
            )
            expect(warnSpy).toHaveBeenCalledWith(
                '[PostHog Next.js] getDistinctId returned a non-string value — falling back to client-provided identity'
            )
            warnSpy.mockRestore()
        })

        it('does not call the resolver when the user is opted out', async () => {
            ;(cookies as jest.Mock).mockResolvedValue(
                createMockCookies({
                    __ph_opt_in_out_phc_test123: '0',
                })
            )
            const getDistinctId = jest.fn(() => 'server-user')

            const { getPostHog } = createPostHog({ apiKey: 'phc_test123', getDistinctId })
            const client = await getPostHog()
            client.capture({ event: 'test_event' })

            expect(getDistinctId).not.toHaveBeenCalled()
            expect(mockWithContext).not.toHaveBeenCalled()
        })

        it('does not call the resolver when no apiKey is available', async () => {
            delete process.env.NEXT_PUBLIC_POSTHOG_KEY
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
            const getDistinctId = jest.fn(() => 'server-user')

            const { getPostHog } = createPostHog({ getDistinctId })
            await getPostHog()

            expect(getDistinctId).not.toHaveBeenCalled()
            warnSpy.mockRestore()
        })

        it('does not re-run the resolver per captured event', async () => {
            const getDistinctId = jest.fn(() => 'server-user')

            const { getPostHog } = createPostHog({ apiKey: 'phc_test123', getDistinctId })
            const client = await getPostHog()
            client.capture({ event: 'one' })
            client.capture({ event: 'two' })

            expect(getDistinctId).toHaveBeenCalledTimes(1)
        })

        it('resolves identity once per request across multiple getPostHog() calls', async () => {
            const getDistinctId = jest.fn(() => 'server-user')

            const { getPostHog } = createPostHog({ apiKey: 'phc_test123', getDistinctId })
            const client1 = await getPostHog()
            const client2 = await getPostHog()
            client1.capture({ event: 'one' })
            client2.capture({ event: 'two' })

            expect(getDistinctId).toHaveBeenCalledTimes(1)
            expect(mockWithContext).toHaveBeenCalledWith(
                expect.objectContaining({ distinctId: 'server-user' }),
                expect.any(Function)
            )
        })

        it('shares an in-flight resolver promise for concurrent getPostHog() calls in the same request', async () => {
            let resolveDistinctId!: (distinctId: string) => void
            const distinctIdPromise = new Promise<string>((resolve) => {
                resolveDistinctId = resolve
            })
            let markResolverStarted!: () => void
            const resolverStarted = new Promise<void>((resolve) => {
                markResolverStarted = resolve
            })
            const getDistinctId = jest.fn(() => {
                markResolverStarted()
                return distinctIdPromise
            })

            // The headers() mock resolves the same store object for the whole
            // test, mirroring how Next returns one headers instance per request.
            const { getPostHog } = createPostHog({ apiKey: 'phc_test123', getDistinctId })
            const clientsPromise = Promise.all([getPostHog(), getPostHog()])

            await resolverStarted
            expect(getDistinctId).toHaveBeenCalledTimes(1)

            resolveDistinctId('server-user')
            const [client1, client2] = await clientsPromise
            client1.capture({ event: 'one' })
            client2.capture({ event: 'two' })

            expect(getDistinctId).toHaveBeenCalledTimes(1)
            expect(mockWithContext).toHaveBeenCalledWith(
                expect.objectContaining({ distinctId: 'server-user' }),
                expect.any(Function)
            )
        })

        it('resolves identity again for a new request', async () => {
            const getDistinctId = jest.fn(() => 'server-user')

            const { getPostHog } = createPostHog({ apiKey: 'phc_test123', getDistinctId })
            await getPostHog()
            ;(headers as jest.Mock).mockResolvedValue(createMockHeaders({}))
            await getPostHog()

            expect(getDistinctId).toHaveBeenCalledTimes(2)
        })

        it('keeps identities separate across interleaved requests on the shared client', async () => {
            const sharedClient = { capture: mockCapture, withContext: mockWithContext, enterContext: mockEnterContext }
            mockGetOrCreateNodeClient.mockReturnValue(sharedClient)

            const factoryA = createPostHog({ apiKey: 'phc_test123', getDistinctId: async () => 'user-a' })
            const factoryB = createPostHog({ apiKey: 'phc_test123', getDistinctId: async () => 'user-b' })

            const [clientA, clientB] = await Promise.all([factoryA.getPostHog(), factoryB.getPostHog()])
            clientA.capture({ event: 'from_a' })
            clientB.capture({ event: 'from_b' })

            expect(mockWithContext).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({ distinctId: 'user-a' }),
                expect.any(Function)
            )
            expect(mockWithContext).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({ distinctId: 'user-b' }),
                expect.any(Function)
            )
        })
    })

    describe('createPostHog (Pages Router)', () => {
        function createMockPagesContext(pagesCookies: Record<string, string> = {}) {
            return {
                req: {
                    headers: {
                        cookie: Object.entries(pagesCookies)
                            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
                            .join('; '),
                    },
                },
                res: {},
                query: {},
                resolvedUrl: '/test',
            } as never
        }

        it('passes the GetServerSidePropsContext to the resolver and applies the server distinct id', async () => {
            const ctx = createMockPagesContext({
                ph_phc_test123_posthog: JSON.stringify({ distinct_id: 'cookie-user' }),
            })
            const { getPostHog } = createPagesPostHog({
                apiKey: 'phc_test123',
                getDistinctId: (resolverContext) => {
                    expect(resolverContext.req).toBe(ctx.req)
                    return 'server-user'
                },
            })

            const client = await getPostHog(ctx)
            client.capture({ event: 'test_event' })

            expect(mockWithContext).toHaveBeenCalledWith(
                expect.objectContaining({ distinctId: 'server-user' }),
                expect.any(Function)
            )
        })

        it('falls back to the cookie distinct id when the resolver returns null', async () => {
            const ctx = createMockPagesContext({
                ph_phc_test123_posthog: JSON.stringify({ distinct_id: 'cookie-user' }),
            })

            const { getPostHog } = createPagesPostHog({ apiKey: 'phc_test123', getDistinctId: () => null })
            const client = await getPostHog(ctx)
            client.capture({ event: 'test_event' })

            expect(mockWithContext).toHaveBeenCalledWith(
                expect.objectContaining({ distinctId: 'cookie-user' }),
                expect.any(Function)
            )
        })

        it('does not call the resolver when the user is opted out', async () => {
            const getDistinctId = jest.fn(() => 'server-user')
            const ctx = createMockPagesContext({ __ph_opt_in_out_phc_test123: '0' })

            const { getPostHog } = createPagesPostHog({ apiKey: 'phc_test123', getDistinctId })
            const client = await getPostHog(ctx)
            client.capture({ event: 'test_event' })

            expect(getDistinctId).not.toHaveBeenCalled()
            expect(mockWithContext).not.toHaveBeenCalled()
        })

        it('never uses enterContext (it does not survive the await boundary back to getServerSideProps)', async () => {
            const ctx = createMockPagesContext({
                ph_phc_test123_posthog: JSON.stringify({ distinct_id: 'cookie-user' }),
            })

            const { getPostHog } = createPagesPostHog({ apiKey: 'phc_test123' })
            await getPostHog(ctx)

            expect(mockEnterContext).not.toHaveBeenCalled()
        })
    })
})

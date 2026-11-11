import { createPostHog } from '../src/composition/npm/index'
import { analytics } from '../src/products/analytics/analytics'
import type { IPostHog } from '../src/core/types'
import { localRemoteConfig } from './helpers'

class TestDocument extends EventTarget {
    constructor(public visibilityState: DocumentVisibilityState) {
        super()
    }
}
const clients: IPostHog[] = []
const options = {
    projectToken: 'ph_pageview_acquisition',
    storage: false,
    navigator: false,
    fetch: false,
    remoteConfig: localRemoteConfig,
    flags: false,
    logs: false,
    surveys: false,
    autocapture: false,
} as const

afterEach(async () => {
    for (const client of clients.splice(0)) await client.dispose()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('whole-product initial pageview acquisition', () => {
    it('acquires analytics and admits the initial pageview before the root factory resolves', async () => {
        vi.stubGlobal('document', new TestDocument('visible'))
        const observed: string[] = []
        const client = await createPostHog({
            ...options,
            extensions: [
                {
                    name: 'observer',
                    setup(host) {
                        host.onEvent(({ event }) => observed.push(event))
                    },
                },
            ],
        })
        clients.push(client)
        expect(client.analytics).toBeDefined()
        expect(observed).toEqual(['$pageview'])
        expect(client.session?.sessionId).toEqual(expect.any(String))
    })

    it('keeps one hidden listener, then acquires once after visible capture becomes permitted', async () => {
        const document = new TestDocument('hidden')
        vi.stubGlobal('document', document)
        const add = vi.spyOn(document, 'addEventListener')
        const remove = vi.spyOn(document, 'removeEventListener')
        const observed: string[] = []
        const client = await createPostHog({
            ...options,
            optOutByDefault: true,
            extensions: [
                {
                    name: 'observer',
                    setup(host) {
                        host.onEvent(({ event }) => {
                            observed.push(event)
                            if (event === '$pageview') client.optIn()
                        })
                    },
                },
            ],
        })
        clients.push(client)
        expect(client.analytics).toBeUndefined()
        client.optIn()
        client.optOut()
        document.visibilityState = 'visible'
        document.dispatchEvent(new Event('visibilitychange'))
        expect(client.analytics).toBeUndefined()
        expect(observed).toEqual([])
        client.optIn()
        client.optIn()
        await client.resolveExtension('analytics')
        expect(client.analytics).toBeDefined()
        expect(observed).toEqual(['$pageview'])
        expect(add.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1)
        expect(remove.mock.calls.filter(([event]) => event === 'visibilitychange')).toHaveLength(1)
    })

    it('does not acquire analytics for a bot-blocked initial pageview', async () => {
        vi.stubGlobal('document', new TestDocument('visible'))
        const client = await createPostHog({ ...options, navigator: { webdriver: true } })
        clients.push(client)
        expect(client.analytics).toBeUndefined()
        expect(client.session).toBeUndefined()
    })

    it('does not retry a bot-rejected initial pageview during later opt-in', async () => {
        const document = new TestDocument('visible')
        const read = vi.fn(() => document)
        vi.stubGlobal('document', undefined)
        Object.defineProperty(globalThis, 'document', { configurable: true, get: read })
        const client = await createPostHog({
            ...options,
            navigator: { webdriver: true },
            extensions: [analytics({ flushInterval: 0 })],
        })
        clients.push(client)
        expect(read).toHaveBeenCalledOnce()
        client.optIn()
        expect(read).toHaveBeenCalledOnce()
        expect(client.session).toBeUndefined()
    })

    it.each(['missing', 'throwing', 'unsupported-visibility', 'listener-failure'] as const)(
        'terminates initial pageview work when document capabilities are %s',
        async (mode) => {
            vi.stubGlobal('document', undefined)
            const add = vi.fn()
            if (mode === 'throwing') {
                Object.defineProperty(globalThis, 'document', {
                    configurable: true,
                    get() {
                        throw new Error('document unavailable')
                    },
                })
            } else if (mode === 'unsupported-visibility') {
                vi.stubGlobal('document', { addEventListener: add })
            } else if (mode === 'listener-failure') {
                add.mockImplementation(() => {
                    throw new Error('listener unavailable')
                })
                vi.stubGlobal('document', {
                    visibilityState: 'hidden',
                    addEventListener: add,
                    removeEventListener() {},
                })
            }
            const observed: string[] = []
            const client = await createPostHog({
                ...options,
                extensions: [
                    analytics({ flushInterval: 0 }),
                    {
                        name: 'observer',
                        setup(host) {
                            host.onEvent(({ event }) => observed.push(event))
                        },
                    },
                ],
            })
            clients.push(client)
            expect(observed).toEqual([])
            expect(client.session).toBeUndefined()
            expect(add).toHaveBeenCalledTimes(mode === 'listener-failure' ? 1 : 0)
            vi.stubGlobal('document', new TestDocument('visible'))
            client.optIn()
            expect(observed).toEqual([])
            expect(client.session).toBeUndefined()
        }
    )

    it('finishes readiness when initial pageview analytics is explicitly disabled', async () => {
        vi.stubGlobal('document', new TestDocument('visible'))
        const client = await createPostHog({ ...options, analytics: false })
        clients.push(client)
        client.optIn()
        expect(await client.resolveExtension('analytics')).toBeUndefined()
        expect(client.analytics).toBeUndefined()
        expect(client.session).toBeUndefined()
    })
})

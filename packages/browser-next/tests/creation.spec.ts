import { localRemoteConfig } from './helpers'
import { createPostHog } from '../src/composition/npm'
import { createPostHog as createCorePostHog } from '../src/composition/npm/core'
import { createPostHogCore } from '../src/core/posthog'
import type { AnalyticsDeliveryFactory } from '../src/products/analytics/analytics-internal'
import type { CorePostHogOptions, Extension, PostHogOptions } from '../src/core/types'
import { createFetch, type SentRequest } from './helpers'

const baseOptions = {
    remoteConfig: localRemoteConfig,
    projectToken: 'ph_test',
    capturePageview: false,
    storage: false,
    navigator: false,
} as const

const modes = [
    { name: 'root', create: createPostHog },
    { name: 'core', create: createCorePostHog },
] as const

const events = (requests: readonly SentRequest[]): string[] =>
    requests
        .flatMap((request) => (request.body?.batch as Array<{ event: string }> | undefined) ?? [])
        .map(({ event }) => event)

describe('client creation', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it.each(modes)('preserves extension setup order and captures during setup: $name', async ({ create }) => {
        const requests: SentRequest[] = []
        const setupOrder: string[] = []
        const hosts: unknown[] = []
        const observer = (name: string): Extension => ({
            name,
            setup(client) {
                setupOrder.push(name)
                hosts.push(client)
                if (name === 'first') client.capture('during-setup')
            },
        })
        const first = observer('first')
        const last = observer('last')
        const extensions = Object.freeze([first, last])
        const options: PostHogOptions = Object.freeze({
            ...baseOptions,
            fetch: createFetch(requests),
            flags: false,
            extensions,
            analytics: { flushAt: 2, flushInterval: 0 },
        })
        const posthog = await create(options)
        expect(hosts).toEqual([posthog, posthog])
        expect(setupOrder).toEqual(['first', 'last'])
        expect(extensions).toEqual([first, last])
        expect(requests).toHaveLength(0)
        posthog.capture('after-setup')
        await posthog.flush()
        expect(requests).toHaveLength(1)
        expect(events(requests)).toEqual(['during-setup', 'after-setup'])
        await posthog.shutdown()
    })

    it.each(modes)('supports frozen accessor-backed configuration: $name', async ({ create }) => {
        class Configuration {
            #token = 'ph_test'
            get projectToken(): string {
                return this.#token
            }
            readonly capturePageview = false
            readonly storage = false
            readonly navigator = false
            readonly fetch = false
            readonly analytics = { flushInterval: 0 }
        }
        const options = Object.freeze(new Configuration())
        const posthog = await create(options)
        expect(posthog.projectToken).toBe('ph_test')
        expect(posthog.canCapture).toBe(true)
        await posthog.shutdown()
    })

    it.each(modes)('snapshots extension order before reading client configuration: $name', async ({ create }) => {
        const order: string[] = []
        const injected = { name: 'injected', setup: vi.fn() }
        const configured: Extension[] = [
            {
                name: 'first',
                setup() {
                    order.push('first')
                    configured.splice(0)
                },
            },
            {
                name: 'last',
                setup: () => {
                    order.push('last')
                },
            },
        ]
        const posthog = await create({
            ...baseOptions,
            fetch: false,
            extensions: configured,
            get projectToken() {
                configured.splice(0, configured.length, injected)
                return 'ph_test'
            },
        })
        expect(order).toEqual(['first', 'last'])
        expect(injected.setup).not.toHaveBeenCalled()
        await posthog.shutdown()
    })

    it.each(modes)('uses analytics defaults when reading its configuration throws: $name', async ({ create }) => {
        const requests: SentRequest[] = []
        const options: PostHogOptions = {
            ...baseOptions,
            flags: false,
            fetch: createFetch(requests),
            get analytics(): never {
                throw new Error('unavailable configuration')
            },
        }
        const posthog = await create(options)
        expect(requests).toHaveLength(0)
        posthog.capture('default-delivery')
        await posthog.flush()
        expect(requests).toHaveLength(1)
        await posthog.shutdown()
    })

    it.each(modes)(
        'warns once that the removed `analytics: false` option still captures: $name',
        async ({ create }) => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const requests: SentRequest[] = []
            const posthog = await create({
                ...baseOptions,
                debug: true,
                flags: false,
                fetch: createFetch(requests),
                analytics: false,
            } as unknown as PostHogOptions)
            posthog.capture('still-captured')
            await posthog.flush()
            expect(events(requests)).toEqual(['still-captured'])
            const removed = warn.mock.calls.filter((args) =>
                String(args[1]).includes('`analytics: false` option was removed')
            )
            expect(removed).toEqual([['[PostHog]', expect.stringContaining('`capturePageview: false`')]])
            warn.mockRestore()
            await posthog.shutdown()
        }
    )

    it.each(modes)('snapshots analytics options when the client is created: $name', async ({ create }) => {
        const requests: SentRequest[] = []
        const configuration = { flushAt: 1, flushInterval: 0 }
        const pending = create({
            ...baseOptions,
            flags: false,
            fetch: createFetch(requests),
            analytics: configuration,
        })
        configuration.flushAt = 100
        const posthog = await pending
        posthog.capture('snapshotted')
        await vi.waitFor(() => expect(requests).toHaveLength(1))
        await posthog.shutdown()
    })

    it('captures the initial pageview after extension setup completes', async () => {
        vi.stubGlobal('document', { visibilityState: 'visible' })
        const order: string[] = []
        let release!: () => void
        const setupGate = new Promise<void>((resolve) => {
            release = resolve
        })
        let ready = false
        const pending = createCorePostHog({
            ...baseOptions,
            capturePageview: true,
            fetch: false,
            extensions: [
                {
                    name: 'observer',
                    async setup(client) {
                        order.push('setup')
                        client.onEvent(({ event }) => order.push(event))
                        await setupGate
                    },
                },
            ],
        }).then((client) => {
            ready = true
            return client
        })
        await vi.waitFor(() => expect(order).toEqual(['setup']))
        expect(ready).toBe(false)
        release()
        const posthog = await pending
        expect(order).toEqual(['setup', '$pageview'])
        await posthog.shutdown()
    })

    it('delivers capture admitted during extension setup and stops flushing after shutdown', async () => {
        const requests: SentRequest[] = []
        const flush = vi.fn(async () => {})
        const posthog = await createCorePostHog({
            ...baseOptions,
            fetch: createFetch(requests),
            analytics: { flushAt: 100, flushInterval: 0 },
            extensions: [
                {
                    name: 'supplied',
                    setup(client) {
                        client.capture('extension-setup', null, { uuid: 'setup-uuid' })
                    },
                    flush,
                },
            ],
        })
        expect(posthog.getExtension('supplied')).toBeDefined()
        await posthog.flush()
        expect(requests).toHaveLength(1)
        expect(requests[0]?.body?.batch).toMatchObject([{ event: 'extension-setup', uuid: 'setup-uuid' }])
        await posthog.shutdown()
        flush.mockClear()
        posthog.capture('after-shutdown')
        await posthog.flush()
        expect(flush).not.toHaveBeenCalled()
        expect(requests).toHaveLength(1)
    })

    it.each(modes)(
        'disconnects an extension whose setup fails, even when cleanup throws: $name',
        async ({ create }) => {
            const dispose = vi.fn(() => {
                throw new Error('cleanup failed')
            })
            const failing: Extension = {
                name: 'failing',
                setup() {
                    throw new Error('initialization failed')
                },
                dispose,
            }
            const unrelated = { name: 'unrelated', setup: vi.fn() }
            const observed = vi.fn()
            const posthog = await create({
                ...baseOptions,
                fetch: false,
                extensions: [failing, unrelated],
            })
            expect(posthog.getExtension('failing')).toBeUndefined()
            expect(Reflect.get(posthog, 'failing')).toBeUndefined()
            expect(unrelated.setup).toHaveBeenCalledOnce()
            expect(dispose).toHaveBeenCalledOnce()
            posthog.onEvent(observed)
            expect(posthog.capture('after-failure')).toBe(true)
            expect(observed).toHaveBeenCalledOnce()
            await posthog.shutdown()
            expect(dispose).toHaveBeenCalledOnce()
        }
    )

    it('keeps the client usable when delivery construction fails', async () => {
        const failingDelivery: AnalyticsDeliveryFactory = () => {
            throw new Error('delivery unavailable')
        }
        const options: CorePostHogOptions = { ...baseOptions, fetch: false }
        const posthog = await createPostHogCore(options, failingDelivery)
        expect(() => posthog.capture('after-failure')).not.toThrow()
        await expect(posthog.captureImmediate('after-failure')).resolves.toMatchObject({
            submitted: 0,
            allPersisted: false,
            error: new Error('Immediate analytics delivery is unavailable'),
        })
        await expect(posthog.flush()).resolves.toBeUndefined()
        await expect(posthog.shutdown()).resolves.toBeUndefined()
    })
})

import { localRemoteConfig } from './helpers'
import { createPostHog } from '../src'
import { analytics } from '../src/analytics'
import { createAnalyticsExtension } from '../src/analytics-buffer'
import { createAnalyticsDelivery } from '../src/analytics-delivery'
import type { AnalyticsDeliveryFactory } from '../src/analytics-internal'
import { createPostHog as createCorePostHog } from '../src/core'
import { createPostHogCore } from '../src/posthog'
import type { CorePostHogOptions, Extension, PostHogOptions } from '../src/types'
import { createFetch, type SentRequest } from './helpers'

const baseOptions = {
    remoteConfig: localRemoteConfig,
    projectToken: 'ph_test',
    capturePageview: false,
    storage: false,
    navigator: false,
} as const

const modes = [
    { name: 'core', create: createCorePostHog, configuration: undefined },
    { name: 'root/lazy', create: createPostHog, configuration: { load: 'lazy' } },
    { name: 'root/eager', create: createPostHog, configuration: { load: 'eager' } },
    { name: 'root/disabled', create: createPostHog, configuration: false },
] as const

describe('client creation', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it.each(modes)('preserves explicit analytics and setup order: $name', async ({ create, configuration }) => {
        const requests: SentRequest[] = []
        const setupOrder: string[] = []
        const supplied = analytics({ flushAt: 2, flushInterval: 0 })
        const observer = (name: string): Extension => ({
            name,
            setup(client) {
                setupOrder.push(name)
                expect(client.getExtension('analytics')).toBe(supplied)
                if (name === 'first') {
                    client.capture('during-setup')
                }
            },
        })
        const first = observer('first')
        const last = observer('last')
        const extensions = Object.freeze([first, supplied, last])
        const options: PostHogOptions = Object.freeze({
            ...baseOptions,
            fetch: createFetch(requests),
            extensions,
            ...(configuration === undefined ? {} : { analytics: configuration }),
        })
        const posthog = await create(options)
        expect(posthog.getExtension('analytics')).toBe(supplied)
        expect(setupOrder).toEqual(['first', 'last'])
        expect(extensions).toEqual([first, supplied, last])
        expect(requests).toHaveLength(0)
        posthog.capture('after-setup')
        await posthog.flush()
        expect(requests).toHaveLength(1)
        expect((requests[0]?.body?.batch as Array<{ event: string }>).map(({ event }) => event)).toEqual([
            'during-setup',
            'after-setup',
        ])
        await posthog.shutdown()
    })

    it.each([
        { name: 'root', create: createPostHog },
        { name: 'core', create: createCorePostHog },
    ])('supports frozen accessor-backed configuration: $name', async ({ create }) => {
        class Configuration {
            #token = 'ph_test'
            get projectToken(): string {
                return this.#token
            }
            readonly capturePageview = false
            readonly storage = false
            readonly navigator = false
            readonly fetch = false
        }
        const options = Object.freeze(new Configuration())
        const posthog = await create(options)
        expect(posthog.projectToken).toBe('ph_test')
        expect(posthog.getExtension('analytics')).toBeDefined()
        await posthog.shutdown()
    })

    it.each([
        { name: 'root', create: createPostHog },
        { name: 'core', create: createCorePostHog },
    ])('snapshots extension order before reading client configuration: $name', async ({ create }) => {
        const order: string[] = []
        const injected = { name: 'injected', setup: vi.fn() }
        const supplied = analytics({ flushInterval: 0 })
        const configured: Extension[] = [
            {
                name: 'first',
                setup() {
                    order.push('first')
                    configured.splice(0)
                },
            },
            supplied,
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
        expect(posthog.getExtension('analytics')).toBe(supplied)
        expect(injected.setup).not.toHaveBeenCalled()
        await posthog.shutdown()
    })

    it('uses lazy defaults when reading automatic analytics configuration throws', async () => {
        const requests: SentRequest[] = []
        const options: PostHogOptions = {
            ...baseOptions,
            fetch: createFetch(requests),
            get analytics(): never {
                throw new Error('unavailable configuration')
            },
        }
        const posthog = await createPostHog(options)
        expect(requests).toHaveLength(0)
        posthog.capture('default-delivery')
        await posthog.flush()
        expect(requests).toHaveLength(1)
        await posthog.shutdown()
    })

    it('constructs automatic analytics from its snapshot before core reads client options', async () => {
        const requests: SentRequest[] = []
        const configuration = { load: 'eager' as const, flushAt: 1, flushInterval: 0 }
        const options: PostHogOptions = {
            ...baseOptions,
            flags: false,
            fetch: createFetch(requests),
            analytics: configuration,
            remoteConfig: localRemoteConfig,
            get projectToken() {
                configuration.flushAt = 100
                return 'ph_test'
            },
        }
        const posthog = await createPostHog(options)
        posthog.capture('snapshotted')
        await vi.waitFor(() => expect(requests).toHaveLength(1))
        await posthog.shutdown()
    })

    it('waits for eager delivery after extension setup and before the initial pageview', async () => {
        vi.stubGlobal('document', { visibilityState: 'visible' })
        const order: string[] = []
        let resolve!: (factory: AnalyticsDeliveryFactory) => void
        const loading = new Promise<AnalyticsDeliveryFactory>((done) => {
            resolve = done
        })
        const load = vi.fn(() => {
            order.push('load')
            return loading
        })
        const supplied = createAnalyticsExtension({ load: 'eager' }, load)
        let ready = false
        const pending = createCorePostHog({
            ...baseOptions,
            capturePageview: true,
            fetch: false,
            extensions: [
                {
                    name: 'observer',
                    setup(client) {
                        order.push('setup')
                        client.onEvent(({ event }) => order.push(event))
                    },
                },
                supplied,
            ],
        }).then((client) => {
            ready = true
            return client
        })
        await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())
        expect(order).toEqual(['setup', 'load'])
        expect(ready).toBe(false)
        resolve(createAnalyticsDelivery)
        const posthog = await pending
        expect(order).toEqual(['setup', 'load', '$pageview'])
        await posthog.shutdown()
    })

    it('assembles, starts, and releases the supplied capture dependency', async () => {
        const order: string[] = []
        const supplied = createAnalyticsExtension()
        const initialize = supplied.initialize
        const initialization = vi.spyOn(supplied, 'initialize').mockImplementation((host) => {
            order.push('initialize')
            initialize(host)
        })
        const start = vi.spyOn(supplied, 'start').mockImplementation(async () => {
            order.push('start')
        })
        const enqueue = vi.spyOn(supplied, 'enqueue')
        const flush = vi.spyOn(supplied, 'flush')
        const extension = {
            name: 'supplied',
            initialize: vi.fn(),
            setup: vi.fn((client: Parameters<Extension['setup']>[0]) => {
                order.push('setup')
                client.capture('during-setup')
            }),
        }
        const options: CorePostHogOptions = {
            ...baseOptions,
            fetch: false,
            extensions: [extension, supplied],
        }
        const posthog = await createPostHogCore(options)
        expect(initialization).toHaveBeenCalledOnce()
        expect(extension.setup).toHaveBeenCalledOnce()
        expect(extension.initialize).not.toHaveBeenCalled()
        expect(start).toHaveBeenCalledOnce()
        expect(order).toEqual(['initialize', 'setup', 'start'])
        expect(posthog.getExtension('supplied')).toBe(extension)
        expect(posthog.getExtension('analytics')).toBe(supplied)
        expect(enqueue).toHaveBeenCalledOnce()
        expect(enqueue.mock.calls[0]?.[0].event).toBe('during-setup')
        await posthog.shutdown()
        flush.mockClear()
        await posthog.flush()
        expect(flush).not.toHaveBeenCalled()
    })

    it('retains capture admitted during analytics setup before host initialization', async () => {
        const requests: SentRequest[] = []
        const supplied = analytics({ flushAt: 1, flushInterval: 0 })
        const setup = supplied.setup
        supplied.setup = async (client) => {
            await setup(client)
            client.capture('analytics-setup', null, { uuid: 'setup-uuid' })
        }
        const posthog = await createCorePostHog({
            ...baseOptions,
            fetch: createFetch(requests),
            extensions: [supplied],
        })
        await posthog.flush()
        expect(requests).toHaveLength(1)
        expect(requests[0]?.body?.batch).toMatchObject([{ event: 'analytics-setup', uuid: 'setup-uuid' }])
        await posthog.shutdown()
    })

    describe.each([
        { name: 'root', create: createPostHog },
        { name: 'core', create: createCorePostHog },
    ])('$name construction failure isolation', ({ create }) => {
        it.each(['setup', 'initialize'] as const)(
            'disconnects failed capture after %s fails, even when cleanup throws',
            async (phase) => {
                const supplied = createAnalyticsExtension()
                const enqueue = vi.spyOn(supplied, 'enqueue')
                const immediate = vi.spyOn(supplied, 'deliverImmediate')
                const flush = vi.spyOn(supplied, 'flush')
                const purge = vi.spyOn(supplied, 'purge')
                vi.spyOn(supplied, phase).mockImplementation(() => {
                    throw new Error('initialization failed')
                })
                const dispose = vi.spyOn(supplied, 'dispose').mockImplementation(() => {
                    throw new Error('cleanup failed')
                })
                const unrelated = { name: 'analytics', setup: vi.fn(), initialize: vi.fn() }
                const posthog = await create({
                    ...baseOptions,
                    fetch: false,
                    extensions: [supplied, unrelated],
                })
                expect(posthog.getExtension('analytics')).toBe(unrelated)
                expect(unrelated.setup).toHaveBeenCalledOnce()
                expect(unrelated.initialize).not.toHaveBeenCalled()
                expect(() => posthog.capture('after-failure')).not.toThrow()
                await expect(posthog.captureImmediate('after-failure')).resolves.toMatchObject({
                    allPersisted: false,
                    error: { message: 'Immediate analytics delivery is unavailable' },
                })
                await posthog.flush()
                posthog.optOut()
                await posthog.shutdown()
                expect(enqueue).not.toHaveBeenCalled()
                expect(immediate).not.toHaveBeenCalled()
                expect(flush).not.toHaveBeenCalled()
                expect(purge).not.toHaveBeenCalled()
                expect(dispose).toHaveBeenCalledOnce()
            }
        )
    })
})

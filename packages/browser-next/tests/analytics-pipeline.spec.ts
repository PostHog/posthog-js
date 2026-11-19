import { createPostHog } from '../src/composition/npm'
import { createPostHog as createCorePostHog } from '../src/composition/npm/core'
import { createPostHogCore } from '../src/core/posthog'
import { analyticsOf } from '../src/products/analytics/analytics-of'
import type { AnalyticsOptions, CorePostHogOptions, IPostHog } from '../src/core/types'
import { createFetch, localRemoteConfig, requireInstalledExtension, type SentRequest } from './helpers'

const base = (requests: SentRequest[]): CorePostHogOptions => ({
    remoteConfig: localRemoteConfig,
    projectToken: 'ph_test',
    capturePageview: false,
    storage: false,
    navigator: false,
    fetch: createFetch(requests),
})

const sentEvents = (requests: SentRequest[]): string[] =>
    requests.flatMap((request) =>
        ((request.body?.batch as Array<{ event: string }> | undefined) ?? []).map((e) => e.event)
    )

const clients: IPostHog[] = []

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.shutdown()))
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('client analytics pipeline', () => {
    it('runs pre-teardown subscribers, contains failures, and removes disposed subscriptions', async () => {
        const events = new EventTarget()
        vi.stubGlobal('addEventListener', events.addEventListener.bind(events))
        vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events))
        vi.stubGlobal('onpagehide', null)
        const requests: SentRequest[] = []
        const client = await createCorePostHog({ ...base(requests), analytics: { flushAt: 100, flushInterval: 0 } })
        const analytics = requireInstalledExtension(analyticsOf(client))
        const failure = analytics.onBeforeTeardown(() => {
            throw new Error('product callback')
        })
        const callback = vi.fn(() => client.capture('product teardown'))
        const subscription = analytics.onBeforeTeardown(callback)
        const skipped = vi.fn()
        const remover = analytics.onBeforeTeardown(() => removed.dispose())
        const removed = analytics.onBeforeTeardown(skipped)
        expect(subscription.deliveryAvailable).toBe(true)
        client.capture('initial')
        await client.flush()
        events.dispatchEvent(new Event('pagehide'))
        expect(callback).toHaveBeenCalledTimes(1)
        expect(skipped).not.toHaveBeenCalled()
        remover.dispose()
        expect(requests.filter(({ init }) => init.keepalive).flatMap(({ body }) => body?.batch ?? [])).toEqual([
            expect.objectContaining({ event: 'product teardown' }),
        ])
        subscription.dispose()
        subscription.dispose()
        failure.dispose()
        events.dispatchEvent(new Event('pagehide'))
        expect(callback).toHaveBeenCalledTimes(1)
        const disposed = vi.fn()
        const stopped = analytics.onBeforeTeardown(disposed)
        await client.dispose()
        events.dispatchEvent(new Event('pagehide'))
        expect(stopped.deliveryAvailable).toBe(false)
        expect(disposed).not.toHaveBeenCalled()
    })

    it('lets configured extensions capture during setup', async () => {
        const requests: SentRequest[] = []
        const client = await createPostHog({
            ...base(requests),
            analytics: { flushAt: 100, flushInterval: 0 },
            extensions: [
                {
                    name: 'captures-during-setup',
                    setup(host) {
                        host.capture('during-setup')
                    },
                },
            ],
        })
        clients.push(client)
        await client.flush()
        expect(sentEvents(requests)).toEqual(['during-setup'])
    })

    it('delivers admitted events from the root client through Capture V1', async () => {
        const requests: SentRequest[] = []
        const client = await createPostHog({ ...base(requests), flags: false })
        clients.push(client)
        client.capture('automatic')
        await client.flush()
        expect(requests).toHaveLength(1)
        expect(requests[0]?.url.pathname).toBe('/i/v1/analytics/events')
        expect(sentEvents(requests)).toEqual(['automatic'])
    })

    it('delivers the default initial pageview', async () => {
        vi.stubGlobal('document', { visibilityState: 'visible' })
        const requests: SentRequest[] = []
        const client = await createPostHog({ ...base(requests), capturePageview: true, flags: false })
        clients.push(client)
        await client.flush()
        expect(sentEvents(requests)).toEqual(['$pageview'])
    })

    it('snapshots scheduling options at creation', async () => {
        const requests: SentRequest[] = []
        const configuration = { flushAt: 1, flushInterval: 0 }
        const client = await createPostHog({ ...base(requests), flags: false, analytics: configuration })
        clients.push(client)
        configuration.flushAt = 100
        configuration.flushInterval = 60_000
        client.capture('snapshotted')
        await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
        expect(requests.map((request) => request.url.pathname)).toEqual(['/i/v1/analytics/events'])
        expect(sentEvents(requests)).toEqual(['snapshotted'])
    })

    it('batches queued events at the configured count', async () => {
        const requests: SentRequest[] = []
        const client = await createCorePostHog({ ...base(requests), analytics: { flushAt: 2, flushInterval: 0 } })
        clients.push(client)
        client.capture('first')
        await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
        expect(requests).toHaveLength(0)
        client.capture('second')
        await client.flush()
        expect(requests).toHaveLength(1)
        expect(sentEvents(requests)).toEqual(['first', 'second'])
    })

    it('snapshots the person-profile policy at creation', async () => {
        const configuration: AnalyticsOptions = { flushAt: 100, flushInterval: 0, personProfiles: 'always' }
        const client = await createCorePostHog({ ...base([]), analytics: configuration })
        clients.push(client)
        configuration.personProfiles = 'never'
        const observed: unknown[] = []
        client.onEvent(({ properties }) => observed.push(properties.$process_person_profile))
        client.capture('anonymous')
        expect(observed).toEqual([true])
    })

    it('isolates failing option getters while retaining other options', async () => {
        const read = vi.fn((): never => {
            throw new Error('person configuration unavailable')
        })
        const requests: SentRequest[] = []
        const configuration: AnalyticsOptions = {
            flushAt: 1,
            flushInterval: 0,
            get personProfiles() {
                return read()
            },
        }
        const client = await createCorePostHog({ ...base(requests), analytics: configuration })
        clients.push(client)
        expect(read).toHaveBeenCalledOnce()
        const observed: unknown[] = []
        client.onEvent(({ properties }) => observed.push(properties.$process_person_profile))
        client.capture('anonymous')
        await client.flush()
        expect(read).toHaveBeenCalledOnce()
        expect(observed).toEqual([false])
        expect(sentEvents(requests)).toEqual(['anonymous'])
    })

    it('keeps the client usable when delivery cannot be constructed', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const failure = new Error('delivery unavailable')
        const client = await createPostHogCore({ ...base([]), debug: true }, () => {
            throw failure
        })
        clients.push(client)
        expect(error).toHaveBeenCalledWith('[PostHog]', 'Event delivery is unavailable', failure)
        const observed: string[] = []
        client.onEvent(({ event }) => observed.push(event))
        expect(client.capture('queued')).toBe(true)
        expect(observed).toEqual(['queued'])
        expect(typeof client.distinctId).toBe('string')
        await expect(client.flush()).resolves.toBeUndefined()
        await expect(client.captureImmediate('now')).resolves.toMatchObject({
            allPersisted: false,
            error: { message: 'Immediate analytics delivery is unavailable' },
        })
    })

    it('expires queued events using their original admission time', async () => {
        vi.useFakeTimers()
        const requests: SentRequest[] = []
        const client = await createCorePostHog({ ...base(requests), analytics: { flushAt: 100, flushInterval: 0 } })
        client.capture('expired')
        await vi.advanceTimersByTimeAsync(60 * 60 * 1_000 + 1)
        client.capture('fresh')
        await client.flush()
        expect(sentEvents(requests)).toEqual(['fresh'])
        await client.shutdown()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('purges queued events on revocation and delivers again after opt-in', async () => {
        const requests: SentRequest[] = []
        const client = await createCorePostHog({ ...base(requests), analytics: { flushAt: 100, flushInterval: 0 } })
        clients.push(client)
        client.capture('purged')
        client.optOut()
        await client.flush()
        expect(requests).toHaveLength(0)
        client.optIn()
        client.capture('after-grant')
        await client.flush()
        expect(sentEvents(requests)).toEqual(['after-grant'])
    })

    it('delivers queued events within shutdown', async () => {
        const requests: SentRequest[] = []
        const client = await createCorePostHog({ ...base(requests), analytics: { flushAt: 100, flushInterval: 0 } })
        client.capture('shutdown')
        await client.shutdown(1_000)
        expect(sentEvents(requests)).toEqual(['shutdown'])
    })

    it('bounds shutdown while delivery remains pending', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn(() => new Promise<Response>(() => {}))
        const client = await createCorePostHog({
            ...base([]),
            fetch,
            analytics: { flushAt: 100, flushInterval: 0 },
        })
        client.capture('pending')
        const shutdown = client.shutdown(5)
        await vi.advanceTimersByTimeAsync(5)
        await shutdown
        expect(fetch).toHaveBeenCalledTimes(1)
    })
})

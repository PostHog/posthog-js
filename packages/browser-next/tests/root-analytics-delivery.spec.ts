import type { AnalyticsDeliveryFactory } from '../src/products/analytics/analytics-internal'
import type { IPostHog, PostHogOptions } from '../src/core/types'
import { localRemoteConfig, requireInstalledExtension } from './helpers'

const options = {
    projectToken: 'ph_root_delivery',
    storage: false,
    navigator: false,
    capturePageview: false,
    flags: false,
    logs: false,
    surveys: false,
    autocapture: false,
    analytics: { flushAt: 100, flushInterval: 0 },
    remoteConfig: localRemoteConfig,
} satisfies PostHogOptions

const clients: IPostHog[] = []
const releases: Array<() => void> = []
const gate = () => {
    let release: () => void = () => {}
    const promise = new Promise<void>((resolve) => {
        release = resolve
    })
    releases.push(release)
    return { promise, release }
}
const observeDelivery = (pending = Promise.resolve(), failures = 0) => {
    const evaluated = vi.fn()
    const initialized = vi.fn<Parameters<AnalyticsDeliveryFactory>, ReturnType<AnalyticsDeliveryFactory>>()
    vi.doMock('../src/products/analytics/delivery/analytics-delivery', async () => {
        evaluated()
        await pending
        const actual = await vi.importActual<typeof import('../src/products/analytics/delivery/analytics-delivery')>(
            '../src/products/analytics/delivery/analytics-delivery'
        )
        initialized.mockImplementation((...args) => {
            if (failures > 0) {
                failures--
                throw new Error('delivery initialization failed')
            }
            return actual.createAnalyticsDelivery(...args)
        })
        return { createAnalyticsDelivery: initialized }
    })
    return { evaluated, initialized }
}
const create = async (settings: Partial<PostHogOptions> = {}) => {
    const batches: Array<Array<Record<string, unknown>>> = []
    const { createPostHog } = await import('../src/composition/npm')
    const client = await createPostHog({
        ...options,
        fetch: async (_input, init) => {
            const { batch } = JSON.parse(String(init?.body)) as { batch: Array<Record<string, unknown>> }
            batches.push(batch)
            return new Response(
                JSON.stringify({
                    results: Object.fromEntries(batch.map(({ uuid }) => [String(uuid), { result: 'ok' }])),
                })
            )
        },
        ...settings,
    })
    clients.push(client)
    return { client, batches }
}

beforeEach(() => {
    vi.resetModules()
})
afterEach(async () => {
    releases.splice(0).forEach((release) => release())
    await Promise.all(clients.splice(0).map((client) => client.shutdown(0)))
    await vi.dynamicImportSettled()
    vi.doUnmock('../src/products/analytics/delivery/analytics-delivery')
    vi.resetModules()
})

it.each([false, true])('leaves delivery unevaluated after flags dependency startup (denied: %s)', async (denied) => {
    const { evaluated, initialized } = observeDelivery()
    const { client, batches } = await create({ flags: { featureFlagEvaluation: false }, optOutByDefault: denied })
    expect(client.featureFlags).toBeDefined()
    expect(client.analytics).toBeDefined()
    expect(evaluated).not.toHaveBeenCalled()
    expect(initialized).not.toHaveBeenCalled()
    await client.flush()
    await client.shutdown()
    expect(evaluated).not.toHaveBeenCalled()
    expect(batches).toEqual([])
})

it('leaves delivery unevaluated after explicit lazy resolution and rejected captures', async () => {
    const { evaluated, initialized } = observeDelivery()
    const { client, batches } = await create()
    expect(client.analytics).toBeUndefined()
    const product = requireInstalledExtension(await client.resolveExtension('analytics'))
    const circular: Record<string, unknown> = {}
    circular.self = circular
    product.capture('invalid', circular)
    product.capture('')
    client.optOut()
    product.capture('denied')
    await client.flush()
    expect(client.session).toBeUndefined()
    expect(evaluated).not.toHaveBeenCalled()
    expect(initialized).not.toHaveBeenCalled()
    expect(batches).toEqual([])
})

it('loads delivery once after synchronous finalized admission, retaining snapshots while import is delayed', async () => {
    const pending = gate()
    const { evaluated, initialized } = observeDelivery(pending.promise)
    const { client, batches } = await create()
    const product = requireInstalledExtension(await client.resolveExtension('analytics'))
    const observed: string[] = []
    product.onEvent(({ event }) => observed.push(event))
    const properties = { phase: 'admitted' }
    const timestamp = new Date('2026-01-01T00:00:00.000Z')
    const originalId = client.distinctId
    expect(product.capture('first', properties, { uuid: 'first-uuid', timestamp })).toBe(true)
    const session = requireInstalledExtension(client.session)
    product.capture('second')
    expect(observed).toEqual(['first', 'second'])
    properties.phase = 'mutated'
    timestamp.setUTCFullYear(2030)
    await product.identify('later-identity')
    await vi.waitFor(() => expect(evaluated).toHaveBeenCalledOnce())
    expect(initialized).not.toHaveBeenCalled()
    expect(batches).toEqual([])
    const flushing = client.flush()
    pending.release()
    await flushing
    expect(initialized).toHaveBeenCalledOnce()
    expect(evaluated).toHaveBeenCalledOnce()
    expect(batches.flat().map(({ event }) => event)).toEqual(['first', 'second', '$identify'])
    expect(batches[0]?.[0]).toMatchObject({
        event: 'first',
        uuid: 'first-uuid',
        timestamp: '2026-01-01T00:00:00.000Z',
        distinct_id: originalId,
        session_id: session.sessionId,
        properties: { phase: 'admitted' },
    })
    expect(client.analytics).toBe(product)
})

it('retains queued events after inner factory failure and retries initialization on flush', async () => {
    const { evaluated, initialized } = observeDelivery(Promise.resolve(), 1)
    const { client, batches } = await create()
    const product = requireInstalledExtension(await client.resolveExtension('analytics'))
    product.capture('retained-first')
    await vi.waitFor(() => expect(initialized).toHaveBeenCalledOnce())
    product.capture('retained-second')
    expect(initialized).toHaveBeenCalledOnce()
    expect(batches).toEqual([])
    await client.flush()
    expect(initialized).toHaveBeenCalledTimes(2)
    expect(evaluated).toHaveBeenCalledOnce()
    expect(batches.flat().map(({ event }) => event)).toEqual(['retained-first', 'retained-second'])
})

it('retains admission after an inner import rejection and retries the recovered chunk on flush', async () => {
    const rejected = vi.fn(() => {
        throw new Error('chunk unavailable')
    })
    vi.doMock('../src/products/analytics/delivery/analytics-delivery', rejected)
    const { client, batches } = await create()
    const product = requireInstalledExtension(await client.resolveExtension('analytics'))
    product.capture('before-recovery')
    await vi.waitFor(() => expect(rejected).toHaveBeenCalledOnce())
    await vi.dynamicImportSettled()
    expect(batches).toEqual([])
    const { evaluated, initialized } = observeDelivery()
    product.capture('after-recovery')
    expect(evaluated).not.toHaveBeenCalled()
    await client.flush()
    expect(evaluated).toHaveBeenCalledOnce()
    expect(initialized).toHaveBeenCalledOnce()
    expect(batches.flat().map(({ event }) => event)).toEqual(['before-recovery', 'after-recovery'])
})

it('cancels revoked immediate work and purges queued work without reviving it after opt-in', async () => {
    const pending = gate()
    const { evaluated, initialized } = observeDelivery(pending.promise)
    const { client, batches } = await create()
    const product = requireInstalledExtension(await client.resolveExtension('analytics'))
    product.capture('purged')
    const immediate = product.captureImmediate('cancelled')
    await vi.waitFor(() => expect(evaluated).toHaveBeenCalledOnce())
    client.optOut()
    client.optIn()
    product.capture('after-grant')
    const flushing = client.flush()
    pending.release()
    const [summary] = await Promise.all([immediate, flushing])
    expect(summary).toMatchObject({
        submitted: 0,
        allPersisted: false,
        error: { message: 'Immediate analytics delivery was cancelled' },
    })
    expect(initialized).toHaveBeenCalledOnce()
    expect(batches.flat().map(({ event }) => event)).toEqual(['after-grant'])
})

it('joins the in-flight import and drains admitted events during shutdown', async () => {
    const pending = gate()
    const { evaluated, initialized } = observeDelivery(pending.promise)
    const { client, batches } = await create()
    const product = requireInstalledExtension(await client.resolveExtension('analytics'))
    product.capture('shutdown-pending')
    await vi.waitFor(() => expect(evaluated).toHaveBeenCalledOnce())
    const closing = client.shutdown(1_000)
    product.capture('after-closing')
    expect(initialized).not.toHaveBeenCalled()
    pending.release()
    await closing
    expect(initialized).toHaveBeenCalledOnce()
    expect(batches.flat().map(({ event }) => event)).toEqual(['shutdown-pending'])
})

it('never initializes late delivery after shutdown wins the pending import', async () => {
    const pending = gate()
    const { evaluated, initialized } = observeDelivery(pending.promise)
    const { client, batches } = await create()
    requireInstalledExtension(await client.resolveExtension('analytics')).capture('too-late')
    await vi.waitFor(() => expect(evaluated).toHaveBeenCalledOnce())
    await client.shutdown(0)
    expect(client.analytics).toBeUndefined()
    pending.release()
    await vi.dynamicImportSettled()
    expect(initialized).not.toHaveBeenCalled()
    expect(batches).toEqual([])
})

it.each([false, true])(
    'awaits eager inner delivery before readiness without flags or pageviews (denied: %s)',
    async (denied) => {
        const pending = gate()
        const { evaluated, initialized } = observeDelivery(pending.promise)
        let ready = false
        const creating = create({ analytics: { load: 'eager' }, optOutByDefault: denied }).then((result) => {
            ready = true
            return result
        })
        await vi.waitFor(() => expect(evaluated).toHaveBeenCalledOnce())
        expect(ready).toBe(false)
        expect(initialized).not.toHaveBeenCalled()
        pending.release()
        const { client, batches } = await creating
        expect(ready).toBe(true)
        expect(client.analytics).toBeDefined()
        expect(initialized).toHaveBeenCalledOnce()
        expect(client.session).toBeUndefined()
        expect(batches).toEqual([])
    }
)

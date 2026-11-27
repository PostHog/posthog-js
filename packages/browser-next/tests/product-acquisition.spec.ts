import { requireInstalledExtension } from './helpers'
import { createPostHog as createCore } from '../src/composition/npm/core'
import { createPostHogCore } from '../src/core/posthog'
import { createAnalyticsDelivery } from '../src/products/analytics/delivery/analytics-delivery'
import { createPostHog } from '../src/composition/npm'
import { flags } from '../src/products/flags/flags'
import { localRemoteConfig } from './helpers'

const base = {
    projectToken: 'ph_products',
    storage: false,
    navigator: false,
    fetch: false,
    capturePageview: false,
    remoteConfig: localRemoteConfig,
    flags: false,
    logs: false,
    surveys: false,
    autocapture: false,
} as const
const clients: Array<Awaited<ReturnType<typeof createCore>>> = []
afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
})

it('does not install products in the manual core without explicit composition', async () => {
    const client = await createCore(base)
    clients.push(client)
    for (const name of ['featureFlags', 'logs', 'surveys', 'autocapture'] as const) {
        expect(client[name]).toBeUndefined()
        expect(await client.resolveExtension(name)).toBeUndefined()
    }
    await client.flush()
    expect(client.session).toBeUndefined()
})

it('captures through the client from a product whose shared implementation captures synchronously', async () => {
    const extension = flags({ featureFlagEvaluation: false, bootstrap: { featureFlags: { checkout: true } } })
    const client = await createPostHog({ ...base, extensions: [extension] })
    clients.push(client)
    const observed: string[] = []
    client.onEvent(({ event }) => observed.push(event))
    expect(requireInstalledExtension(client.featureFlags).getFeatureFlag('checkout')?.enabled).toBe(true)
    expect(observed).toEqual(['$feature_flag_called'])
})

it('initializes automatic flags before root readiness', async () => {
    const client = await createPostHog({
        ...base,
        flags: { featureFlagEvaluation: false, bootstrap: { featureFlags: { checkout: true } } },
    })
    clients.push(client)
    const observed: string[] = []
    client.onEvent(({ event }) => observed.push(event))
    expect(requireInstalledExtension(client.featureFlags).getFeatureFlag('checkout')?.enabled).toBe(true)
    expect(observed).toEqual(['$feature_flag_called'])
})

it('reuses an explicitly supplied dependency even when another product resolves it first', async () => {
    const extension = flags({ featureFlagEvaluation: false })
    const setup = vi.spyOn(extension, 'setup')
    let dependency: unknown
    const client = await createPostHog({
        ...base,
        extensions: [
            {
                name: 'consumer',
                async setup(host) {
                    dependency = await host.resolveExtension('featureFlags')
                },
            },
            extension,
        ],
    })
    clients.push(client)
    expect(dependency).toBe(extension)
    expect(setup).toHaveBeenCalledOnce()
})

it('does not publish an in-flight product when shutdown starts after its setup hook returns', async () => {
    let finishFlush!: () => void
    const flushing = new Promise<void>((resolve) => {
        finishFlush = resolve
    })
    let observe!: (value: unknown) => void
    const observed = new Promise<unknown>((resolve) => {
        observe = resolve
    })
    let closing: Promise<void> | undefined
    const extension = {
        name: 'late',
        setup: vi.fn(() => {
            // Runs after setup returns and before installation resumes.
            queueMicrotask(() => {
                closing = client.shutdown()
                queueMicrotask(() => observe(Reflect.get(client, 'late')))
            })
        }),
        dispose: vi.fn(),
    }
    const client = await createPostHogCore(
        base,
        createAnalyticsDelivery,
        [{ name: 'waiting', setup() {}, flush: () => flushing }],
        { late: () => extension }
    )
    clients.push(client)
    const installing = client.resolveExtension('late')
    try {
        expect(await observed).toBeUndefined()
        expect(await installing).toBeUndefined()
        expect(extension.setup).toHaveBeenCalledOnce()
        expect(extension.dispose).toHaveBeenCalledOnce()
    } finally {
        finishFlush()
        await closing
        await installing
    }
    expect(extension.dispose).toHaveBeenCalledOnce()
})

it('does not acquire new products once shutdown starts', async () => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
        finish = resolve
    })
    const load = vi.fn(() => ({ name: 'late', setup() {} }))
    const client = await createPostHogCore(
        base,
        createAnalyticsDelivery,
        [{ name: 'waiting', setup() {}, flush: () => pending }],
        { late: load }
    )
    clients.push(client)
    const closing = client.shutdown()
    try {
        expect(await client.resolveExtension('late')).toBeUndefined()
        expect(Reflect.get(client, 'late')).toBeUndefined()
        expect(load).not.toHaveBeenCalled()
    } finally {
        finish()
        await closing
    }
})

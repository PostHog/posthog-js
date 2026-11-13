import { requireInstalledExtension } from './helpers'
import { createPostHog as createCore } from '../src/core'
import { createPostHogCore } from '../src/posthog'
import { createPostHog } from '../src'
import { analytics } from '../src/analytics'
import { flags } from '../src/flags'
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

it('does not construct analytics in the manual core without explicit composition', async () => {
    const client = await createCore(base)
    clients.push(client)
    expect(client.analytics).toBeUndefined()
    expect(await client.resolveExtension('analytics')).toBeUndefined()
    await client.flush()
    expect(client.session).toBeUndefined()
})

it('acquires the entire analytics product on demand and then admits captures synchronously', async () => {
    const client = await createPostHog(base)
    clients.push(client)
    expect(client.analytics).toBeUndefined()
    const [first, second] = await Promise.all([
        client.resolveExtension('analytics'),
        client.resolveExtension('analytics'),
    ])
    expect(first).toBeDefined()
    expect(second).toBe(first)
    expect(client.analytics).toBe(first)
    const observed: string[] = []
    requireInstalledExtension(first).onEvent(({ event }) => observed.push(event))
    expect(requireInstalledExtension(first).capture('after_acquisition')).toBe(true)
    expect(observed).toEqual(['after_acquisition'])
})

it('does not implicitly acquire disabled analytics', async () => {
    const client = await createPostHog({ ...base, analytics: false })
    clients.push(client)
    expect(client.analytics).toBeUndefined()
    expect(await client.resolveExtension('analytics')).toBeUndefined()
    expect(client.session).toBeUndefined()
})

it('prefers an explicitly composed analytics instance to disabled automatic loading', async () => {
    const extension = analytics({ flushInterval: 0 })
    const client = await createPostHog({ ...base, analytics: false, extensions: [extension] })
    clients.push(client)
    expect(client.analytics).toBe(extension)
    expect(await client.resolveExtension('analytics')).toBe(extension)
})

it('acquires analytics before exposing a product whose shared implementation captures synchronously', async () => {
    const extension = flags({ featureFlagEvaluation: false, bootstrap: { featureFlags: { checkout: true } } })
    const client = await createPostHog({ ...base, extensions: [extension] })
    clients.push(client)
    expect(client.analytics).toBeDefined()
    const observed: string[] = []
    requireInstalledExtension(client.analytics).onEvent(({ event }) => observed.push(event))
    expect(requireInstalledExtension(client.featureFlags).getFeatureFlag('checkout')?.enabled).toBe(true)
    expect(observed).toEqual(['$feature_flag_called'])
})

it('initializes automatic flags and their analytics dependency before root readiness', async () => {
    const client = await createPostHog({
        ...base,
        flags: { featureFlagEvaluation: false, bootstrap: { featureFlags: { checkout: true } } },
    })
    clients.push(client)
    const product = requireInstalledExtension(client.analytics)
    const observed: string[] = []
    product.onEvent(({ event }) => observed.push(event))
    expect(requireInstalledExtension(client.featureFlags).getFeatureFlag('checkout')?.enabled).toBe(true)
    expect(observed).toEqual(['$feature_flag_called'])
})

it('keeps flags usable with analytics explicitly disabled, without loading a capture product', async () => {
    const extension = flags({ featureFlagEvaluation: false, bootstrap: { featureFlags: { checkout: true } } })
    const client = await createPostHog({ ...base, analytics: false, extensions: [extension] })
    clients.push(client)
    expect(client.analytics).toBeUndefined()
    expect(requireInstalledExtension(client.featureFlags).getFeatureFlag('checkout')?.enabled).toBe(true)
    expect(client.session).toBeUndefined()
})

it('reuses an explicitly supplied dependency even when another product resolves it first', async () => {
    const extension = flags({ featureFlagEvaluation: false })
    const setup = vi.spyOn(extension, 'setup')
    let dependency: unknown
    const client = await createPostHog({
        ...base,
        analytics: false,
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
            queueMicrotask(() =>
                queueMicrotask(() => {
                    closing = client.shutdown()
                    queueMicrotask(() => observe(Reflect.get(client, 'late')))
                })
            )
        }),
        dispose: vi.fn(),
    }
    const client = await createPostHogCore(base, [{ name: 'waiting', setup() {}, flush: () => flushing }], {
        late: () => extension,
    })
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
    const client = await createPostHog({ ...base, extensions: [{ name: 'waiting', setup() {}, flush: () => pending }] })
    clients.push(client)
    const closing = client.shutdown()
    try {
        expect(await client.resolveExtension('analytics')).toBeUndefined()
        expect(client.analytics).toBeUndefined()
    } finally {
        finish()
        await closing
    }
})

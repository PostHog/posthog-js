import type { SendRequestInit } from '@posthog/browser-common'
import { FeatureFlagsCommonExtension } from '@posthog/browser-common/extension-tokens'
import { createPostHog as createCore } from '../src/composition/npm/core'
import { createPostHog as createRoot } from '../src/composition/npm'
import { analytics } from '../src/products/analytics/analytics'
import { featureFlags } from '../src/products/flags/flags'
import {
    createFetch,
    internalHost,
    localRemoteConfig,
    MemoryStorage,
    withInternalHost,
    type SentRequest,
} from './helpers'

const defaults = {
    projectToken: 'ph_test',
    remoteConfig: localRemoteConfig,
    capturePageview: false,
    navigator: false,
} as const
const create = withInternalHost(createCore)

describe('internal request authority', () => {
    it.each([createCore, createRoot])('keeps transport on scoped hosts, not the returned client', async (factory) => {
        const client = await withInternalHost(factory)({ ...defaults, storage: false, fetch: false })
        expect('sendRequest' in client).toBe(false)
        expect(typeof internalHost(client).sendRequest).toBe('function')
        expect(typeof internalHost(client).sharedClient.sendRequest).toBe('function')
        expect(internalHost(client)).not.toBe(client)
        await client.dispose()
    })

    it.each([undefined, false, true])(
        'uses explicit opt-out permission %s without changing consent',
        async (permission) => {
            const storage = new MemoryStorage()
            const requests: SentRequest[] = []
            const client = await create({ ...defaults, storage, fetch: createFetch(requests) })
            client.optOut()
            const persisted = new Map(storage.values)
            const changes = vi.fn()
            const subscription = client.onConsentChange(changes)
            for (const send of [internalHost(client).sendRequest, internalHost(client).sharedClient.sendRequest]) {
                const init: SendRequestInit = permission === undefined ? {} : { allowWhileOptedOut: permission }
                const response = await send('/internal/', init)
                expect(response.statusCode).toBe(permission === true ? 200 : 0)
            }
            expect(requests).toHaveLength(permission === true ? 2 : 0)
            expect(client.hasOptedOut()).toBe(true)
            expect(storage.values).toEqual(persisted)
            expect(changes).not.toHaveBeenCalled()
            subscription.dispose()
            await client.dispose()
        }
    )

    it.each(['', 'ph_test'])(
        'retains missing-token and bot restrictions with permission (%s)',
        async (projectToken) => {
            const requests: SentRequest[] = []
            const client = await create({
                ...defaults,
                projectToken,
                storage: false,
                navigator: projectToken ? { userAgent: 'Googlebot/2.1' } : false,
                fetch: createFetch(requests),
            })
            await expect(
                internalHost(client).sendRequest('/internal/', { allowWhileOptedOut: true })
            ).resolves.toMatchObject({ statusCode: 0 })
            expect(requests).toHaveLength(0)
            await client.dispose()
        }
    )

    it.each(['https://external.example/request', '//external.example/request', '/\\external.example/request'])(
        'retains configured-host restrictions with permission: %s',
        async (path) => {
            const requests: SentRequest[] = []
            const client = await create({
                ...defaults,
                storage: false,
                optOutByDefault: true,
                fetch: createFetch(requests),
            })
            await expect(internalHost(client).sendRequest(path, { allowWhileOptedOut: true })).resolves.toMatchObject({
                statusCode: 0,
            })
            expect(requests).toHaveLength(0)
            await client.dispose()
        }
    )

    it.each(['GET', 'POST'] as const)('retains Beacon transport eligibility with permission: %s', async (method) => {
        const sendBeacon = vi.fn(() => true)
        const client = await create({
            ...defaults,
            storage: false,
            optOutByDefault: true,
            fetch: false,
            navigator: { sendBeacon },
        })
        const response = await internalHost(client).sendRequest('/internal/', {
            allowWhileOptedOut: true,
            method,
            transport: 'sendBeacon',
            body: { test: true },
        })
        expect(response.statusCode).toBe(method === 'POST' ? 202 : 0)
        expect(sendBeacon).toHaveBeenCalledTimes(method === 'POST' ? 1 : 0)
        await client.dispose()
    })

    it.each([false, true])(
        'checks dispatch-time consent after request construction with permission %s',
        async (allowWhileOptedOut) => {
            const requests: SentRequest[] = []
            const client = await create({ ...defaults, storage: false, fetch: createFetch(requests) })
            const response = await internalHost(client).sendRequest('/internal/', {
                allowWhileOptedOut,
                get headers() {
                    client.optOut()
                    return { 'X-Test': 'value' }
                },
            })
            expect(response.statusCode).toBe(allowWhileOptedOut ? 200 : 0)
            expect(requests).toHaveLength(allowWhileOptedOut ? 1 : 0)
            expect(client.hasOptedOut()).toBe(true)
            await client.dispose()
        }
    )

    it('contains a throwing permission getter', async () => {
        const requests: SentRequest[] = []
        const client = await create({ ...defaults, storage: false, fetch: createFetch(requests) })
        await expect(
            internalHost(client).sendRequest('/internal/', {
                get allowWhileOptedOut(): boolean {
                    throw new Error('permission unavailable')
                },
            })
        ).resolves.toMatchObject({ statusCode: 0, error: expect.any(Error) })
        expect(requests).toHaveLength(0)
        await client.dispose()
    })

    it('permits shared listing while evaluation, enrollment telemetry, surveys and logs remain gated', async () => {
        const requests: SentRequest[] = []
        const storage = new MemoryStorage()
        const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            await createFetch(requests)(input, init)
            return new Response(JSON.stringify({ earlyAccessFeatures: [{ id: 'feature-id', flagKey: 'beta' }] }))
        })
        const client = await create({
            ...defaults,
            storage,
            fetch,
            optOutByDefault: true,
            extensions: [analytics({ flushInterval: 0 }), featureFlags({ refreshIntervalMs: 0 })],
        })
        const host = internalHost(client)
        const flags = host.sharedClient.getExtension(FeatureFlagsCommonExtension)!
        const callback = vi.fn()
        flags.getEarlyAccessFeatures(callback)
        await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce())
        flags.updateEarlyAccessFeatureEnrollment('beta', true)
        host.sharedClient.capture('ordinary telemetry')
        for (const path of ['/flags/?v=2', '/api/surveys/', '/i/v1/logs']) {
            await expect(host.sendRequest(path)).resolves.toMatchObject({ statusCode: 0 })
        }
        await client.flush()
        expect(requests.map(({ url }) => url.pathname)).toEqual(['/api/early_access_features/'])
        expect(client.hasOptedOut()).toBe(true)
        expect(storage.getItem('__ph_opt_in_out_ph_test')).not.toBe('1')
        await client.dispose()
    })
})

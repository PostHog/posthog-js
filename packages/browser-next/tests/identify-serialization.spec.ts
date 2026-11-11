import { analytics } from '../src/products/analytics/analytics'
import { createPostHog } from '../src/composition/npm/core'
import { flags } from '../src/products/flags/flags'
import { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import { createFetch, localRemoteConfig, requireInstalledExtension, type SentRequest } from './helpers'

const clients: Array<Awaited<ReturnType<typeof createPostHog>>> = []
const create = async () => {
    const requests: SentRequest[] = []
    const client = await createPostHog({
        projectToken: 'ph_identify_serialization',
        storage: false,
        navigator: false,
        capturePageview: false,
        remoteConfig: localRemoteConfig,
        fetch: createFetch(requests),
        extensions: [analytics({ flushInterval: 0 }), flags({ featureFlagEvaluation: false })],
    })
    clients.push(client)
    return { client, product: requireInstalledExtension(client.analytics), requests }
}
const events = (requests: SentRequest[]) => requests.flatMap((request) => request.body?.batch ?? [])

afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.restoreAllMocks()
})

describe('identify person-property serialization', () => {
    it('retains a valid identity transition when person properties cannot be serialized', async () => {
        const { client, product, requests } = await create()
        const anonymousId = client.anonymousId
        const deviceId = client.deviceId
        const anonymousContext = vi.spyOn(PostHogFeatureFlags.prototype, 'setAnonymousDistinctId')
        const reloadFlags = vi.spyOn(PostHogFeatureFlags.prototype, 'reloadFeatureFlags')
        const notified = vi.fn(() => expect(client.distinctId).toBe('new-id'))
        client.onIdentify(notified)
        const set = { amount: BigInt(1) }
        await product.identify('new-id', set)
        expect(notified).toHaveBeenCalledTimes(1)
        expect(notified).toHaveBeenCalledWith({
            distinctId: 'new-id',
            previousDistinctId: anonymousId,
            wasIdentified: false,
            set,
            setOnce: undefined,
        })
        expect(anonymousContext).toHaveBeenCalledWith(anonymousId)
        expect(reloadFlags).toHaveBeenCalledTimes(1)
        expect(client.distinctId).toBe('new-id')
        expect(client.anonymousId).toBe(anonymousId)
        expect(client.deviceId).toBe(deviceId)
        expect(client.session).toBeUndefined()
        await client.flush()
        expect(events(requests)).toEqual([])
        await product.identify('new-id')
        product.capture('after_identify')
        await client.flush()
        expect(events(requests)).toEqual([expect.objectContaining({ event: 'after_identify', distinct_id: 'new-id' })])
    })

    it.each(['toJSON', 'getter'] as const)(
        'serializes %s person properties after the identity transition',
        async (kind) => {
            const { client, product, requests } = await create()
            const anonymousId = client.distinctId
            const readIdentity = () => ({ distinctId: client.distinctId, anonymousId: client.anonymousId })
            const set =
                kind === 'toJSON'
                    ? { toJSON: readIdentity }
                    : {
                          get identity() {
                              return readIdentity()
                          },
                      }
            await product.identify('new-id', set)
            await client.flush()
            const identity = { distinctId: 'new-id', anonymousId }
            expect(events(requests)).toEqual([
                expect.objectContaining({
                    event: '$identify',
                    distinct_id: 'new-id',
                    properties: expect.objectContaining({
                        $anon_distinct_id: anonymousId,
                        $set: kind === 'toJSON' ? identity : { identity },
                    }),
                }),
            ])
        }
    )
})

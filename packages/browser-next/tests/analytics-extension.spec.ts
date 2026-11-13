import type { CaptureOptions } from '@posthog/browser-common'
import { analytics } from '../src/analytics'
import { createPostHog } from '../src/core'
import { createFetch, localRemoteConfig, type SentRequest } from './helpers'

const clients: Array<Awaited<ReturnType<typeof createPostHog>>> = []
const create = async () => {
    const requests: SentRequest[] = []
    const product = analytics({ flushAt: 100, flushInterval: 0 })
    const client = await createPostHog({
        projectToken: 'ph_runtime_policies',
        storage: false,
        navigator: false,
        capturePageview: false,
        remoteConfig: localRemoteConfig,
        extensions: [product],
        fetch: createFetch(requests),
    })
    clients.push(client)
    return { client, product, requests }
}
const events = (requests: SentRequest[]): Array<{ event: string; properties: Record<string, unknown> }> =>
    requests.flatMap(
        (request) => (request.body?.batch ?? []) as Array<{ event: string; properties: Record<string, unknown> }>
    )
afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.restoreAllMocks()
})

describe('analytics extension operation ownership', () => {
    it.each([{}, { delivery: 'unload' }] as const)(
        'returns the capture rate-limit status independently of admission: %j',
        async (options) => {
            const raw = analytics()
            expect(raw.capture('unbound', null, options)).toBe(true)
            await raw.dispose?.()
            const { product, client } = await create()
            expect(product.capture('accepted', null, options)).toBe(true)
            client.optOut()
            expect(product.capture('denied', null, options)).toBe(true)
            await client.dispose()
            expect(product.capture('disposed', null, options)).toBe(true)
        }
    )

    it('rate limits unload capture through the same admission policy', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(42)
        const { product } = await create()
        for (let index = 0; index < 100; index++) expect(product.capture('burst')).toBe(true)
        expect(product.capture('limited', null, { delivery: 'unload' })).toBe(false)
    })

    it('contains delivery-option getters before and after installation', async () => {
        const options: CaptureOptions = {
            get delivery(): 'unload' {
                throw new Error('delivery getter failed')
            },
        }
        const raw = analytics()
        expect(raw.capture('unbound', null, options)).toBe(true)
        await raw.dispose?.()
        const { product } = await create()
        expect(product.capture('installed', null, options)).toBe(true)
    })

    it('keeps raw identity operations safe before setup and after disposal', async () => {
        const raw = analytics()
        await expect(raw.identify('unbound')).resolves.toBeUndefined()
        await expect(raw.group('organization', 'unbound')).resolves.toBeUndefined()
        await raw.dispose?.()
        const { product, client, requests } = await create()
        const distinctId = client.distinctId
        await product.dispose?.()
        await expect(product.identify('product-disposed')).resolves.toBeUndefined()
        await expect(product.group('organization', 'product-disposed', { invalid: true })).resolves.toBeUndefined()
        expect(client.distinctId).toBe(distinctId)
        expect(client.groups).toEqual({})
        await client.dispose()
        await expect(product.identify('disposed')).resolves.toBeUndefined()
        await expect(product.group('organization', 'disposed', { invalid: true })).resolves.toBeUndefined()
        expect(events(requests)).toHaveLength(0)
    })
})

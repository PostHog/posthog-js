import { createPostHog } from '../src/composition/npm'
import { createAnalyticsExtension } from '../src/products/analytics/analytics-buffer'
import { analytics } from '../src/products/analytics/automatic-analytics'
import type { AutomaticAnalyticsOptions } from '../src/core/types'

vi.mock('../src/products/analytics/automatic-analytics', () => ({ analytics: vi.fn() }))

const options = {
    projectToken: 'ph_test',
    capturePageview: false,
    storage: false,
    navigator: false,
    fetch: false,
    flags: false,
    logs: false,
    surveys: false,
    autocapture: false,
} as const

describe('default analytics acquisition', () => {
    beforeEach(() => {
        vi.mocked(analytics).mockReset().mockImplementation(createAnalyticsExtension)
    })

    it('defers construction until acquisition and shares the installed instance', async () => {
        const client = await createPostHog(options)
        expect(analytics).not.toHaveBeenCalled()
        expect(client.analytics).toBeUndefined()
        const extension = await client.resolveExtension('analytics')
        expect(analytics).toHaveBeenCalledOnce()
        expect(analytics).toHaveBeenCalledWith({})
        expect(client.analytics).toBe(extension)
        expect(await client.resolveExtension('analytics')).toBe(extension)
        expect(analytics).toHaveBeenCalledOnce()
        await client.shutdown()
    })

    it('acquires an eager product before creation resolves', async () => {
        const configuration: AutomaticAnalyticsOptions = Object.freeze({ load: 'eager', flushAt: 1 })
        const client = await createPostHog({ ...options, analytics: configuration })
        expect(analytics).toHaveBeenCalledOnce()
        expect(analytics).toHaveBeenCalledWith(configuration)
        expect(client.analytics).toBeDefined()
        await client.shutdown()
    })

    it('snapshots product configuration independently of the later acquisition time', async () => {
        const configuration: AutomaticAnalyticsOptions = { flushAt: 1, personProfiles: 'never' }
        const client = await createPostHog({ ...options, analytics: configuration })
        configuration.flushAt = 99
        configuration.personProfiles = 'always'
        await client.resolveExtension('analytics')
        expect(analytics).toHaveBeenCalledWith({ flushAt: 1, personProfiles: 'never' })
        await client.shutdown()
    })

    it('isolates a failing person-policy getter while retaining other product options', async () => {
        const read = vi.fn((): never => {
            throw new Error('person configuration unavailable')
        })
        const configuration: AutomaticAnalyticsOptions = {
            flushInterval: 0,
            get personProfiles() {
                return read()
            },
        }
        const client = await createPostHog({ ...options, analytics: configuration })
        expect(read).toHaveBeenCalledOnce()
        await client.resolveExtension('analytics')
        expect(read).toHaveBeenCalledOnce()
        expect(analytics).toHaveBeenCalledWith({ flushInterval: 0 })
        await client.shutdown()
    })

    it('leaves supplied analytics alone without reading automatic configuration', async () => {
        const supplied = createAnalyticsExtension()
        const read = vi.fn(() => {
            throw new Error('automatic configuration must not be read')
        })
        const client = await createPostHog({
            ...options,
            extensions: [supplied],
            get analytics() {
                return read()
            },
        })
        expect(read).not.toHaveBeenCalled()
        expect(analytics).not.toHaveBeenCalled()
        expect(client.analytics).toBe(supplied)
        await client.shutdown()
    })

    it('does not construct automatic analytics when disabled', async () => {
        const client = await createPostHog({ ...options, analytics: false })
        expect(await client.resolveExtension('analytics')).toBeUndefined()
        expect(analytics).not.toHaveBeenCalled()
        await client.shutdown()
    })

    it('isolates a constructor failure without exposing an incomplete analytics namespace', async () => {
        vi.mocked(analytics).mockImplementation(() => {
            throw new Error('analytics could not initialize')
        })
        const client = await createPostHog(options)
        expect(await client.resolveExtension('analytics')).toBeUndefined()
        expect(client.analytics).toBeUndefined()
        expect(typeof client.distinctId).toBe('string')
        await expect(client.flush()).resolves.toBeUndefined()
        vi.mocked(analytics).mockImplementation(createAnalyticsExtension)
        const recovered = await client.resolveExtension('analytics')
        expect(recovered).toBeDefined()
        expect(client.analytics).toBe(recovered)
        expect(analytics).toHaveBeenCalledTimes(2)
        await client.shutdown()
    })
})

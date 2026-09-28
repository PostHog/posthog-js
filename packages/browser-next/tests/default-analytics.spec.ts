import { createPostHog } from '../src'
import { createAnalyticsExtension } from '../src/analytics-buffer'
import { analytics } from '../src/automatic-analytics'
import type { AutomaticAnalyticsOptions } from '../src/types'

vi.mock('../src/automatic-analytics', () => ({ analytics: vi.fn() }))

const options = {
    projectToken: 'ph_test',
    capturePageview: false,
    storage: false,
    navigator: false,
    fetch: false,
} as const

describe('default analytics selection', () => {
    beforeEach(() => {
        vi.mocked(analytics).mockReset().mockImplementation(createAnalyticsExtension)
    })

    it('constructs analytics synchronously with lazy defaults', async () => {
        const pending = createPostHog(options)
        const constructionCount = vi.mocked(analytics).mock.calls.length
        const client = await pending
        expect(constructionCount).toBe(1)
        expect(analytics).toHaveBeenCalledOnce()
        expect(analytics).toHaveBeenCalledWith({ load: 'lazy' })
        expect(client.getExtension('analytics')).toBe(vi.mocked(analytics).mock.results[0]?.value)
        await client.shutdown()
    })

    it('passes the original analytics configuration to its constructor', async () => {
        const configuration: AutomaticAnalyticsOptions = Object.freeze({ load: 'eager', flushAt: 1 })
        const client = await createPostHog({ ...options, analytics: configuration })
        expect(vi.mocked(analytics).mock.calls[0]?.[0]).toBe(configuration)
        await client.shutdown()
    })

    it('leaves supplied analytics alone without reading automatic configuration', async () => {
        const supplied = createAnalyticsExtension()
        const client = await createPostHog({
            ...options,
            extensions: Object.freeze([supplied]),
            get analytics(): never {
                throw new Error('automatic configuration must not be read')
            },
        })
        expect(analytics).not.toHaveBeenCalled()
        expect(client.getExtension('analytics')).toBe(supplied)
        await client.shutdown()
    })

    it('does not construct automatic analytics when disabled', async () => {
        const client = await createPostHog({ ...options, analytics: false })
        expect(analytics).not.toHaveBeenCalled()
        await client.shutdown()
    })

    it('contains an automatic analytics constructor failure', async () => {
        vi.mocked(analytics).mockImplementation(() => {
            throw new Error('analytics could not initialize')
        })
        const client = await createPostHog(options)
        expect(() => client.capture('buffered')).not.toThrow()
        await expect(client.flush()).resolves.toBeUndefined()
        await client.shutdown()
    })
})

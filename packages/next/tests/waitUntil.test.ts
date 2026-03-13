vi.mock('server-only', () => ({}))

const mockVercelWaitUntil = vi.fn()

vi.mock('@vercel/functions', () => ({
    waitUntil: mockVercelWaitUntil,
}))

const mockPostHogConstructor = vi.fn()

vi.mock('posthog-node', () => ({
    PostHog: mockPostHogConstructor,
}))

describe('nodeClientCache waitUntil auto-detection', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        jest.resetModules()
    })

    it('auto-detects @vercel/functions waitUntil and applies to new clients', async () => {
        const { getOrCreateNodeClient } = require('../src/server/nodeClientCache')

        await getOrCreateNodeClient('phc_test', { host: 'https://test.com' })

        expect(mockPostHogConstructor).toHaveBeenCalledWith(
            'phc_test',
            expect.objectContaining({ waitUntil: mockVercelWaitUntil })
        )
    })

    it('explicit options.waitUntil takes priority over auto-detected', async () => {
        const { getOrCreateNodeClient } = require('../src/server/nodeClientCache')

        const explicitWaitUntil = vi.fn()
        await getOrCreateNodeClient('phc_test3', { host: 'https://test3.com', waitUntil: explicitWaitUntil })

        expect(mockPostHogConstructor).toHaveBeenCalledWith(
            'phc_test3',
            expect.objectContaining({ waitUntil: explicitWaitUntil })
        )
    })
})

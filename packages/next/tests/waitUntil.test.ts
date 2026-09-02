vi.mock('server-only', () => ({}))

const { mockVercelWaitUntil, mockPostHogConstructor } = vi.hoisted(() => ({
    mockVercelWaitUntil: vi.fn(),
    mockPostHogConstructor: vi.fn(),
}))

vi.mock('@vercel/functions', () => ({
    waitUntil: mockVercelWaitUntil,
}))

vi.mock('posthog-node', () => ({
    PostHog: mockPostHogConstructor,
}))

describe('clientCache.node waitUntil auto-detection', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.resetModules()
    })

    it('auto-detects @vercel/functions waitUntil and applies to new clients', async () => {
        const { getOrCreateNodeClient } = await import('../src/server/clientCache.node')

        await getOrCreateNodeClient('phc_test', { host: 'https://test.com' })

        expect(mockPostHogConstructor).toHaveBeenCalledWith(
            'phc_test',
            expect.objectContaining({ waitUntil: mockVercelWaitUntil })
        )
    })

    it('explicit options.waitUntil takes priority over auto-detected', async () => {
        const { getOrCreateNodeClient } = await import('../src/server/clientCache.node')

        const explicitWaitUntil = vi.fn()
        await getOrCreateNodeClient('phc_test3', { host: 'https://test3.com', waitUntil: explicitWaitUntil })

        expect(mockPostHogConstructor).toHaveBeenCalledWith(
            'phc_test3',
            expect.objectContaining({ waitUntil: explicitWaitUntil })
        )
    })
})

vi.mock('server-only', () => ({}))

const { mockPostHogConstructor } = vi.hoisted(() => ({
    mockPostHogConstructor: vi.fn(() => ({})),
}))

vi.mock('posthog-node', () => ({
    PostHog: mockPostHogConstructor,
}))

async function loadTwoModuleCopies() {
    vi.resetModules()
    const first = await import('../src/server/clientCache.node')
    vi.resetModules()
    const second = await import('../src/server/clientCache.node')
    return { first, second }
}

describe('clientCache.node cache sharing', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.resetModules()
    })

    // With default Next.js bundling, instrumentation and App Router handlers load
    // their own copy of this module (separate webpack layers). Without a shared
    // cache, each copy creates its own PostHog client for the same key, so the
    // OTel span processor (reading one client's context) and withPostHogContext
    // (writing another's) can disagree about the current request context.
    it.each([
        ['the first copy created the client', 'first', 'second', 'phc_test_a'],
        ['the second copy created the client', 'second', 'first', 'phc_test_b'],
    ] as const)('reuses the client across module copies when %s', async (_, creator, reader, apiKey) => {
        const copies = await loadTwoModuleCopies()
        expect(copies.second).not.toBe(copies.first)

        const created = await copies[creator].getOrCreateNodeClient(apiKey, { host: 'https://test.com' })
        const read = await copies[reader].getOrCreateNodeClient(apiKey, { host: 'https://test.com' })

        expect(read).toBe(created)
        expect(mockPostHogConstructor).toHaveBeenCalledTimes(1)
    })
})

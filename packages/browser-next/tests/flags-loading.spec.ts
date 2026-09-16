import type { Extension } from '@posthog/browser-common'

const options = {
    projectToken: 'test',
    navigator: false,
    storage: false,
    fetch: false,
    capturePageview: false,
    analytics: false,
} as const

afterEach(() => {
    vi.doUnmock('../src/flags')
    vi.resetModules()
    vi.restoreAllMocks()
})

describe('automatic flags module loading', () => {
    it('waits for the dynamic module and extension setup before returning the client', async () => {
        let loaded!: (module: { flags: () => Extension }) => void
        let setupFinished!: () => void
        const setupGate = new Promise<void>((resolve) => {
            setupFinished = resolve
        })
        const setup = vi.fn(() => setupGate)
        vi.doMock(
            '../src/flags',
            () =>
                new Promise((resolve) => {
                    loaded = resolve
                })
        )
        const { createPostHog } = await import('../src')
        const finished = vi.fn()
        const configuration = { bootstrap: { featureFlags: { test: 'original' } } }
        const pending = createPostHog({ ...options, flags: configuration }).then((client) => {
            finished()
            return client
        })
        await vi.waitFor(() => expect(loaded).toBeDefined())
        expect(finished).not.toHaveBeenCalled()
        configuration.bootstrap.featureFlags.test = 'mutated'
        const factory = vi.fn(() => ({ name: 'featureFlags', setup }))
        loaded({ flags: factory })
        await vi.waitFor(() => expect(setup).toHaveBeenCalledOnce())
        expect(finished).not.toHaveBeenCalled()
        expect(factory).toHaveBeenCalledWith({ bootstrap: { featureFlags: { test: 'original' } } })
        setupFinished()
        const client = await pending
        expect(client.getExtension('featureFlags')).toBeDefined()
        await client.dispose()
    })

    it('contains a rejected chunk load and returns a usable capture client', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.doMock('../src/flags', () => {
            throw new Error('chunk unavailable')
        })
        const { createPostHog } = await import('../src')
        const client = await createPostHog(options)
        expect(client.getExtension('featureFlags')).toBeUndefined()
        const captured = vi.fn()
        client.onEvent(captured)
        client.capture('still usable')
        expect(captured).toHaveBeenCalledOnce()
        await client.dispose()
    })

    it.each(['disabled', 'static'])('does not import the automatic module for %s inclusion', async (mode) => {
        const imported = vi.fn(() => {
            throw new Error('must not load')
        })
        vi.doMock('../src/flags', imported)
        const { createPostHog } = await import('../src')
        const explicit: Extension = { name: 'featureFlags', setup() {} }
        const client = await createPostHog({
            ...options,
            ...(mode === 'disabled' ? { flags: false as const } : { extensions: [explicit] }),
        })
        expect(imported).not.toHaveBeenCalled()
        expect(client.getExtension('featureFlags')).toBe(mode === 'disabled' ? undefined : explicit)
        await client.dispose()
    })
})

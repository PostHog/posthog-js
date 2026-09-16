import type { Extension } from '@posthog/browser-common'

const options = {
    projectToken: 'test',
    navigator: false,
    storage: false,
    fetch: false,
    capturePageview: false,
    analytics: false,
    flags: false,
    logs: false,
    surveys: false,
} as const

afterEach(() => {
    vi.doUnmock('../src/autocapture')
    vi.doUnmock('../src/flags')
    vi.resetModules()
    vi.restoreAllMocks()
})

describe('automatic autocapture module loading', () => {
    it('snapshots configuration before awaiting earlier product imports', async () => {
        let loadFlags!: (module: { flags: () => Extension }) => void
        vi.doMock(
            '../src/flags',
            () =>
                new Promise((resolve) => {
                    loadFlags = resolve
                })
        )
        const factory = vi.fn(() => ({ name: 'autocapture', setup() {} }))
        vi.doMock('../src/autocapture', () => ({ autocapture: factory }))
        const { createPostHog } = await import('../src')
        const configuration = { cssSelectorAllowlist: ['.original'] }
        const pending = createPostHog({ ...options, flags: {}, autocapture: configuration })
        await vi.waitFor(() => expect(loadFlags).toBeDefined())
        configuration.cssSelectorAllowlist[0] = '.mutated'
        loadFlags({ flags: () => ({ name: 'featureFlags', setup() {} }) })
        const client = await pending
        try {
            expect(factory).toHaveBeenCalledWith({ cssSelectorAllowlist: ['.original'] })
        } finally {
            await client.dispose()
        }
    })

    it('waits for the dynamic module and extension setup before returning the client', async () => {
        let loaded!: (module: { autocapture: () => Extension }) => void
        let setupFinished!: () => void
        const setupGate = new Promise<void>((resolve) => {
            setupFinished = resolve
        })
        const setup = vi.fn(() => setupGate)
        vi.doMock(
            '../src/autocapture',
            () =>
                new Promise((resolve) => {
                    loaded = resolve
                })
        )
        const { createPostHog } = await import('../src')
        const finished = vi.fn()
        const configuration = { cssSelectorAllowlist: ['.original'] }
        const pending = createPostHog({ ...options, autocapture: configuration }).then((client) => {
            finished()
            return client
        })
        await vi.waitFor(() => expect(loaded).toBeDefined())
        expect(finished).not.toHaveBeenCalled()
        configuration.cssSelectorAllowlist[0] = '.mutated'
        const factory = vi.fn(() => ({ name: 'autocapture', setup }))
        loaded({ autocapture: factory })
        await vi.waitFor(() => expect(setup).toHaveBeenCalledOnce())
        expect(finished).not.toHaveBeenCalled()
        expect(factory).toHaveBeenCalledWith({ cssSelectorAllowlist: ['.original'] })
        setupFinished()
        const client = await pending
        expect(client.getExtension('autocapture')).toBeDefined()
        await client.dispose()
    })

    it('contains a rejected chunk load and returns a usable capture client', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.doMock('../src/autocapture', () => {
            throw new Error('chunk unavailable')
        })
        const { createPostHog } = await import('../src')
        const client = await createPostHog(options)
        expect(client.getExtension('autocapture')).toBeUndefined()
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
        vi.doMock('../src/autocapture', imported)
        const { createPostHog } = await import('../src')
        const explicit: Extension = { name: 'autocapture', setup() {} }
        const client = await createPostHog({
            ...options,
            ...(mode === 'disabled' ? { autocapture: false as const } : { extensions: [explicit] }),
        })
        expect(imported).not.toHaveBeenCalled()
        expect(client.getExtension('autocapture')).toBe(mode === 'disabled' ? undefined : explicit)
        await client.dispose()
    })
})

import type { Extension } from '@posthog/browser-common'

const options = {
    projectToken: 'test',
    navigator: false,
    storage: false,
    fetch: false,
    capturePageview: false,
    analytics: false,
    flags: false,
} as const

afterEach(() => {
    vi.doUnmock('../src/logs')
    vi.resetModules()
    vi.restoreAllMocks()
})

describe('automatic logs module loading', () => {
    it('waits for the dynamic module and extension setup before returning the client', async () => {
        let loaded!: (module: { logs: () => Extension }) => void
        let setupFinished!: () => void
        const setupGate = new Promise<void>((resolve) => {
            setupFinished = resolve
        })
        const setup = vi.fn(() => setupGate)
        vi.doMock(
            '../src/logs',
            () =>
                new Promise((resolve) => {
                    loaded = resolve
                })
        )
        const { createPostHog } = await import('../src')
        const finished = vi.fn()
        const configuration = { serviceName: 'original' }
        const pending = createPostHog({ ...options, logs: configuration }).then((client) => {
            finished()
            return client
        })
        configuration.serviceName = 'mutated'
        await vi.waitFor(() => expect(loaded).toBeDefined())
        expect(finished).not.toHaveBeenCalled()
        const factory = vi.fn(() => ({ name: 'logs', setup }))
        loaded({ logs: factory })
        await vi.waitFor(() => expect(setup).toHaveBeenCalledOnce())
        expect(finished).not.toHaveBeenCalled()
        expect(factory).toHaveBeenCalledWith({ serviceName: 'original' })
        setupFinished()
        const client = await pending
        expect(client.getExtension('logs')).toBeDefined()
        await client.dispose()
    })

    it('contains a rejected chunk load and returns a usable capture client', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.doMock('../src/logs', () => {
            throw new Error('chunk unavailable')
        })
        const { createPostHog } = await import('../src')
        const client = await createPostHog(options)
        expect(client.getExtension('logs')).toBeUndefined()
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
        vi.doMock('../src/logs', imported)
        const { createPostHog } = await import('../src')
        const explicit: Extension = { name: 'logs', setup() {} }
        const client = await createPostHog({
            ...options,
            ...(mode === 'disabled' ? { logs: false as const } : { extensions: [explicit] }),
        })
        expect(imported).not.toHaveBeenCalled()
        expect(client.getExtension('logs')).toBe(mode === 'disabled' ? undefined : explicit)
        await client.dispose()
    })
})

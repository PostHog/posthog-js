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
} as const

afterEach(() => {
    vi.doUnmock('../src/automatic-surveys')
    vi.resetModules()
    vi.restoreAllMocks()
})

describe('automatic surveys module loading', () => {
    it('waits for the dynamic module and extension setup before returning the client', async () => {
        let loaded!: (module: { surveys: () => Extension }) => void
        let setupFinished!: () => void
        const setupGate = new Promise<void>((resolve) => {
            setupFinished = resolve
        })
        const setup = vi.fn(() => setupGate)
        vi.doMock(
            '../src/automatic-surveys',
            () =>
                new Promise((resolve) => {
                    loaded = resolve
                })
        )
        const { createPostHog } = await import('../src')
        const finished = vi.fn()
        const configuration = { overrideDisplayLanguage: 'en' }
        const pending = createPostHog({ ...options, surveys: configuration }).then((client) => {
            finished()
            return client
        })
        await vi.waitFor(() => expect(loaded).toBeDefined())
        expect(finished).not.toHaveBeenCalled()
        configuration.overrideDisplayLanguage = 'fr'
        const factory = vi.fn(() => ({ name: 'surveys', setup }))
        loaded({ surveys: factory })
        await vi.waitFor(() => expect(setup).toHaveBeenCalledOnce())
        expect(finished).not.toHaveBeenCalled()
        expect(factory).toHaveBeenCalledWith({ overrideDisplayLanguage: 'en' })
        setupFinished()
        const client = await pending
        expect(client.getExtension('surveys')).toBeDefined()
        await client.dispose()
    })

    it('contains a rejected chunk load and returns a usable capture client', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.doMock('../src/automatic-surveys', () => {
            throw new Error('chunk unavailable')
        })
        const { createPostHog } = await import('../src')
        const client = await createPostHog(options)
        expect(client.getExtension('surveys')).toBeUndefined()
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
        vi.doMock('../src/automatic-surveys', imported)
        const { createPostHog } = await import('../src')
        const explicit: Extension = { name: 'surveys', setup() {} }
        const client = await createPostHog({
            ...options,
            ...(mode === 'disabled' ? { surveys: false as const } : { extensions: [explicit] }),
        })
        expect(imported).not.toHaveBeenCalled()
        expect(client.getExtension('surveys')).toBe(mode === 'disabled' ? undefined : explicit)
        await client.dispose()
    })
})

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
    autocapture: false,
} as const

afterEach(() => {
    vi.doUnmock('../src/replay')
    vi.resetModules()
    vi.restoreAllMocks()
})

describe('automatic replay loading', () => {
    it('awaits the controller module and extension setup with snapshotted options', async () => {
        let loaded!: (module: { replay: (options: unknown) => Extension }) => void
        let setupDone!: () => void
        const setup = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    setupDone = resolve
                })
        )
        vi.doMock(
            '../src/replay',
            () =>
                new Promise((resolve) => {
                    loaded = resolve
                })
        )
        const { createPostHog } = await import('../src')
        const mask = (text: string) => text
        const configuration = { attributeFilter: ['id'], maskInputFn: mask }
        const finished = vi.fn()
        const pending = createPostHog({ ...options, replay: configuration }).then((client) => {
            finished()
            return client
        })
        await vi.waitFor(() => expect(loaded).toBeDefined())
        configuration.attributeFilter.push('secret')
        const factory = vi.fn(() => ({ name: 'sessionRecording', setup }))
        loaded({ replay: factory })
        await vi.waitFor(() => expect(setup).toHaveBeenCalledOnce())
        expect(finished).not.toHaveBeenCalled()
        expect(factory).toHaveBeenCalledWith({ attributeFilter: ['id'], maskInputFn: mask })
        setupDone()
        const client = await pending
        expect(client.getExtension('sessionRecording')).toBeDefined()
        await client.dispose()
    })

    it.each(['disabled', 'explicit', 'core'])('does not load the controller for %s composition', async (mode) => {
        const imported = vi.fn(() => {
            throw new Error('must not load')
        })
        vi.doMock('../src/replay', imported)
        const { createPostHog } = await import('../src')
        const explicit = { name: 'sessionRecording', setup() {} }
        const client =
            mode === 'core'
                ? await (await import('../src/core')).createPostHog(options)
                : await createPostHog({
                      ...options,
                      ...(mode === 'explicit' ? { extensions: [explicit] } : { replay: false }),
                  })
        expect(imported).not.toHaveBeenCalled()
        expect(client.getExtension('sessionRecording')).toBe(mode === 'explicit' ? explicit : undefined)
        await client.dispose()
    })

    it('contains import and configuration getter failures', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.doMock('../src/replay', () => {
            throw new Error('chunk failed')
        })
        const { createPostHog } = await import('../src')
        const client = await createPostHog(options)
        expect(client.getExtension('sessionRecording')).toBeUndefined()
        const event = vi.fn()
        client.onEvent(event)
        client.capture('still usable')
        expect(event).toHaveBeenCalledOnce()
        await client.dispose()
        const denied = await createPostHog({
            ...options,
            get replay(): never {
                throw new Error('getter failed')
            },
        })
        expect(denied.getExtension('sessionRecording')).toBeUndefined()
        await denied.dispose()
    })
})

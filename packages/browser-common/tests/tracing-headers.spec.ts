import { patchFetch, patchXHR } from '../src/utils/tracing-headers'

type BrowserWindow = Window & typeof globalThis

const createWindow = (fetch: typeof globalThis.fetch): BrowserWindow =>
    ({ location: { href: 'https://app.example.com/', origin: 'https://app.example.com' }, fetch }) as BrowserWindow

const sentHeaders = (fetch: ReturnType<typeof vi.fn>): Headers =>
    new Headers((fetch.mock.calls[0]![1] as RequestInit | undefined)?.headers)

describe('shared tracing headers patches', () => {
    it('reads the distinct id and session from providers for each request', async () => {
        const fetch = vi.fn(async () => new Response())
        const win = createWindow(fetch)
        let distinctId = 'first'
        const session = vi.fn(() => ({ sessionId: 'session', windowId: 'window' }))
        const restore = patchFetch(win, ['api.example.com'], () => distinctId, session)
        distinctId = 'second'

        await win.fetch('/work', { method: 'POST' })
        await win.fetch('https://api.example.com/work')

        expect(session).toHaveBeenCalledTimes(1)
        expect(Object.fromEntries(sentHeaders(fetch))).toEqual({})
        expect(Object.fromEntries(new Headers(fetch.mock.calls[1]![1]!.headers))).toEqual({
            'x-posthog-distinct-id': 'second',
            'x-posthog-session-id': 'session',
            'x-posthog-window-id': 'window',
        })
        restore()
        expect(win.fetch).toBe(fetch)
    })

    it('omits headers whose provider has no value', async () => {
        const fetch = vi.fn(async () => new Response())
        const win = createWindow(fetch)
        patchFetch(
            win,
            ['api.example.com'],
            () => undefined,
            () => undefined
        )
        const init = { method: 'POST' }
        await win.fetch('https://api.example.com/work', init)
        expect(fetch).toHaveBeenCalledWith('https://api.example.com/work', init)
    })

    it('does nothing without a window or XMLHttpRequest', () => {
        const restoreFetch = patchFetch(undefined, ['api.example.com'], () => 'id')
        const restoreXHR = patchXHR(createWindow(vi.fn()), ['api.example.com'], () => 'id')
        expect(() => {
            restoreFetch()
            restoreXHR()
        }).not.toThrow()
    })
})

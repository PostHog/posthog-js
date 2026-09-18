// @vitest-environment jsdom
import { createPostHog } from '../src'
import { createPostHog as createCore } from '../src/core'
import { autocapture } from '../src/autocapture'
import type { AutocaptureOptions } from '../src/autocapture'
import type { PostHog, PostHogOptions } from '../src/types'
import { MemoryStorage } from './helpers'

const base = {
    projectToken: 'ph_autocapture',
    storage: false,
    navigator: false,
    fetch: false,
    capturePageview: false,
    analytics: false,
    flags: false,
    logs: false,
    surveys: false,
} as const
const config = {
    toolbarParams: {},
    toolbarVersion: 'toolbar' as const,
    isAuthenticated: false,
    siteApps: [],
    supportedCompression: [],
    autocapture_opt_out: false,
}
const clients: PostHog[] = []
const create = async (options: Partial<PostHogOptions> = {}) => {
    const client = await createPostHog({
        ...base,
        ...(options.fetch ? {} : { remoteConfig: config }),
        ...options,
    })
    clients.push(client)
    return client
}
const click = (selector = 'button') => (document.querySelector(selector) as HTMLElement).click()
beforeEach(() => {
    document.body.innerHTML = '<button data-public="safe"><span>Save</span></button>'
    vi.useFakeTimers()
})
afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('autocapture', () => {
    it.each(['static', 'dynamic'])('captures clicks, changes and submits through %s inclusion', async (mode) => {
        const extension = autocapture()
        const client = await create(mode === 'static' ? { autocapture: false, extensions: [extension] } : {})
        const captured = vi.fn()
        client.onEvent(captured)
        click('span')
        expect(captured).toHaveBeenCalledWith(
            expect.objectContaining({
                event: '$autocapture',
                properties: expect.objectContaining({ $event_type: 'click' }),
            })
        )
        document.body.innerHTML = '<form><input type="checkbox"></form>'
        document.querySelector('input')!.dispatchEvent(new Event('change', { bubbles: true }))
        document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))
        expect(captured.mock.calls.map(([event]) => event.properties.$event_type)).toEqual([
            'click',
            'change',
            'submit',
        ])
        if (mode === 'static') expect(client.getExtension('autocapture')).toBe(extension)
    })
    it('omits disabled and manual core autocapture', async () => {
        const disabled = await create({ autocapture: false })
        const core = await createCore(base)
        clients.push(core)
        expect(disabled.getExtension('autocapture')).toBeUndefined()
        expect(core.getExtension('autocapture')).toBeUndefined()
    })
    it('does not capture before remote config or when opted out remotely', async () => {
        let resolve!: (value: Response) => void
        const client = await create({
            fetch: () =>
                new Promise((r) => {
                    resolve = r
                }),
        })
        const captured = vi.fn()
        client.onEvent(captured)
        click()
        expect(captured).not.toHaveBeenCalled()
        resolve(new Response(JSON.stringify({ ...config, autocapture_opt_out: true })))
        await vi.advanceTimersByTimeAsync(1)
        click()
        expect(captured).not.toHaveBeenCalled()
    })
    it.each([true, false])('retains persisted remote opt-out %s on a failed fetch', async (disabled) => {
        const storage = new MemoryStorage()
        const first = await create({ storage, remoteConfig: { ...config, autocapture_opt_out: disabled } })
        await first.dispose()
        const second = await create({
            storage,
            fetch: async () => {
                throw new Error('offline')
            },
        })
        await vi.advanceTimersByTimeAsync(1)
        const captured = vi.fn()
        second.onEvent(captured)
        click()
        expect(captured).toHaveBeenCalledTimes(disabled ? 0 : 1)
    })
    it.each(['missing', 'failed'])('keeps unknown server opt-out disabled after %s config', async (outcome) => {
        const client = await create(
            outcome === 'failed'
                ? {
                      fetch: async () => {
                          throw new Error('offline')
                      },
                  }
                : {
                      remoteConfig: {
                          toolbarParams: {},
                          toolbarVersion: 'toolbar',
                          isAuthenticated: false,
                          siteApps: [],
                          supportedCompression: [],
                      },
                  }
        )
        await vi.advanceTimersByTimeAsync(1)
        const captured = vi.fn()
        client.onEvent(captured)
        click()
        expect(captured).not.toHaveBeenCalled()
    })
    it('isolates a failed setup from manual capture', async () => {
        const client = await create({ autocapture: { urlAllowlist: ['['] } })
        expect(client.getExtension('autocapture')).toBeUndefined()
        const captured = vi.fn()
        client.onEvent(captured)
        click()
        client.capture('manual')
        expect(captured.mock.calls.map(([event]) => event.event)).toEqual(['manual'])
    })
    it('gates capture by consent and removes handlers on disposal', async () => {
        const client = await create({ optOutByDefault: true })
        const captured = vi.fn()
        client.onEvent(captured)
        click()
        expect(captured).not.toHaveBeenCalled()
        client.optIn()
        click()
        expect(captured).toHaveBeenCalledTimes(1)
        client.optOut()
        click()
        expect(captured).toHaveBeenCalledTimes(1)
        client.optIn()
        await client.dispose()
        click()
        expect(captured).toHaveBeenCalledTimes(1)
    })
    it('maps masking, attribute exclusions and safe URL defaults', async () => {
        document.body.innerHTML = '<a href="https://external.test/path#secret" data-public="safe">Documentation</a>'
        const client = await create({ autocapture: { elementAttributeIgnorelist: ['data-public'], maskAllText: true } })
        const captured = vi.fn()
        client.onEvent(captured)
        click('a')
        const properties = captured.mock.calls[0]![0].properties
        expect(JSON.stringify(properties)).not.toContain('secret')
        expect(JSON.stringify(properties)).not.toContain('Documentation')
        expect(JSON.stringify(properties)).not.toContain('data-public')
        await client.dispose()
        const masked = await create({ autocapture: { maskAllElementAttributes: true } })
        const maskedCapture = vi.fn()
        masked.onEvent(maskedCapture)
        click('a')
        expect(JSON.stringify(maskedCapture.mock.calls[0]![0].properties)).not.toContain('attr__')
    })
    it('redacts sensitive controls and excludes opted-out ancestors', async () => {
        const client = await create()
        const captured = vi.fn()
        client.onEvent(captured)
        document.body.innerHTML =
            '<div class="ph-no-capture"><button>Hidden</button></div><input type="password" value="secret"><button data-ph-no-autocapture>Private</button>'
        document.querySelectorAll<HTMLElement>('button').forEach((element) => element.click())
        expect(captured).not.toHaveBeenCalled()
        click('input')
        expect(captured).toHaveBeenCalledOnce()
        expect(JSON.stringify(captured.mock.calls[0]![0].properties)).not.toContain('secret')
    })
    it('preserves RegExp/callback options and snapshots arrays at factory creation', async () => {
        const options: AutocaptureOptions = {
            urlAllowlist: [/allowed/],
            getCurrentUrl: () => 'https://example.test/allowed',
            cssSelectorAllowlist: ['button'],
            domEventAllowlist: ['click'],
        }
        const extension = autocapture(options)
        options.cssSelectorAllowlist![0] = '.missing'
        options.urlAllowlist!.splice(0)
        const client = await create({ extensions: [extension] })
        const captured = vi.fn()
        client.onEvent(captured)
        click()
        expect(captured).toHaveBeenCalledTimes(1)
    })
    it('lets URL and selector ignorelists override allowlists', async () => {
        const first = await create({
            autocapture: {
                urlAllowlist: [/allowed/],
                urlIgnorelist: [/allowed/],
                getCurrentUrl: () => 'https://example.test/allowed',
            },
        })
        const captured = vi.fn()
        first.onEvent(captured)
        click()
        expect(captured).not.toHaveBeenCalled()
        await first.dispose()
        const second = await create({
            autocapture: { cssSelectorAllowlist: ['button'], cssSelectorIgnorelist: ['button'] },
        })
        second.onEvent(captured)
        click()
        expect(captured).not.toHaveBeenCalled()
    })
    it('does not enable clipboard capture by default', async () => {
        const client = await create()
        const captured = vi.fn()
        client.onEvent(captured)
        vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'copied words' } as Selection)
        document.querySelector('button')!.dispatchEvent(new Event('copy', { bubbles: true }))
        expect(captured).not.toHaveBeenCalled()
        await client.dispose()
        const enabled = await create({ autocapture: { captureCopiedText: true } })
        enabled.onEvent(captured)
        document.querySelector('button')!.dispatchEvent(new Event('copy', { bubbles: true }))
        expect(captured).toHaveBeenCalledWith(expect.objectContaining({ event: '$copy_autocapture' }))
    })
    it('uses safer rageclick defaults and allows threshold configuration', async () => {
        document.querySelector('button')!.textContent = '+'
        const client = await create()
        const captured = vi.fn()
        client.onEvent(captured)
        click()
        click()
        click()
        expect(captured.mock.calls.some(([event]) => event.event === '$rageclick')).toBe(false)
        await client.dispose()
        const custom = await create({ autocapture: { rageclick: { contentIgnorelist: false, clickCount: 2 } } })
        custom.onEvent(captured)
        click()
        click()
        expect(captured.mock.calls.some(([event]) => event.event === '$rageclick')).toBe(true)
    })
    it('picks up selectors from an already installed surveys capability without sharing mutable sets', async () => {
        const selectors = new Set(['button'])
        const client = await create({
            extensions: [
                {
                    name: 'surveys',
                    setup() {},
                    getElementSelectors: () => selectors,
                } as import('@posthog/browser-common').Extension,
            ],
        })
        selectors.clear()
        const captured = vi.fn()
        client.onEvent(captured)
        click()
        expect(captured.mock.calls[0]![0].properties.$element_selectors).toEqual(['button'])
    })
})

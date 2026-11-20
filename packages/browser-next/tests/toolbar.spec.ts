// @vitest-environment jsdom
import { TOOLBAR_ID } from '@posthog/browser-common/constants'
import { createPostHog as createRootPostHog } from '../src/composition/npm'
import { createPostHog as createCorePostHog } from '../src/composition/npm/core'
import { toolbar } from '../src/products/toolbar/toolbar'
import { getUiHost } from '../src/core/posthog'
import type { ToolbarParams } from '../src/products/toolbar/toolbar-options'
import type { CorePostHogOptions, RemoteConfig } from '../src/core/types'

type ToolbarWindow = Window & {
    ph_toolbar_state?: number
    ph_load_toolbar?: (params: ToolbarParams, instance?: unknown) => void
}
const toolbarWindow = window as ToolbarWindow

const options = {
    projectToken: 'test_token',
    storage: false,
    fetch: false,
    navigator: false,
    capturePageview: false,
    // The toolbar reads no remote configuration fields.
    remoteConfig: {} as RemoteConfig,
} satisfies CorePostHogOptions

const encodeState = (state: Record<string, unknown>): string => encodeURIComponent(btoa(JSON.stringify(state)))
const authorizeState = { action: 'ph_authorize', token: 'test_token', accessToken: 'secret', desiredHash: '#app' }

const toolbarScripts = (): HTMLScriptElement[] =>
    Array.from(document.querySelectorAll<HTMLScriptElement>('script')).filter((script) =>
        script.src.includes('/static/toolbar.js')
    )

const finishScriptLoad = (): void => {
    const script = toolbarScripts().at(-1)
    script?.onload?.(new Event('load'))
}

beforeEach(() => {
    delete toolbarWindow.ph_toolbar_state
    toolbarWindow.ph_load_toolbar = vi.fn(() => {
        const element = document.createElement('div')
        element.id = TOOLBAR_ID
        document.body.appendChild(element)
    })
    localStorage.clear()
    history.replaceState(null, '', '/page?query=1')
})

afterEach(() => {
    document.getElementById(TOOLBAR_ID)?.remove()
    for (const script of toolbarScripts()) script.remove()
    delete toolbarWindow.ph_load_toolbar
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('toolbar', () => {
    it('loads the toolbar from an authorization hash, restores the desired hash and saves the parameters', async () => {
        location.hash = `__posthog=${encodeState(authorizeState)}`
        const extension = toolbar()
        const client = await createCorePostHog({
            ...options,
            apiHost: 'https://ingest.example.com',
            uiHost: 'https://app.example.com/',
            extensions: [extension],
        })

        expect(location.hash).toBe('#app')
        const [script] = toolbarScripts()
        expect(script?.src).toMatch(/^https:\/\/ingest\.example\.com\/static\/toolbar\.js\?v=[^&]+&t=\d+$/)
        expect(script?.crossOrigin).toBe('anonymous')
        finishScriptLoad()

        const expected = { ...authorizeState, source: 'url', apiURL: 'https://app.example.com' }
        expect(toolbarWindow.ph_load_toolbar).toHaveBeenCalledWith(expected, undefined)
        const { source: _source, ...saved } = expected
        expect(JSON.parse(localStorage.getItem('_postHogToolbarParams') ?? '')).toEqual(saved)
        expect(toolbarWindow.ph_toolbar_state).toBe(2)
        await client.dispose()
    })

    it('accepts the legacy url-encoded state parameter', async () => {
        location.hash = `state=${encodeURIComponent(JSON.stringify({ action: 'ph_authorize', token: 'test_token' }))}`
        const client = await createCorePostHog({ ...options, extensions: [toolbar()] })

        expect(location.hash).toBe('')
        expect(location.pathname + location.search).toBe('/page?query=1')
        expect(toolbarScripts()).toHaveLength(1)
        await client.dispose()
    })

    it('resumes a saved toolbar session without its one-time intent', async () => {
        localStorage.setItem(
            '_postHogToolbarParams',
            JSON.stringify({ token: 'test_token', userIntent: 'add-action', accessToken: 'secret' })
        )
        const client = await createCorePostHog({ ...options, extensions: [toolbar()] })
        finishScriptLoad()

        expect(toolbarWindow.ph_load_toolbar).toHaveBeenCalledWith(
            {
                token: 'test_token',
                accessToken: 'secret',
                source: 'localstorage',
                apiURL: 'https://us.posthog.com',
            },
            undefined
        )
        await client.dispose()
    })

    it('ignores parameters for another project', async () => {
        location.hash = `__posthog=${encodeState({ ...authorizeState, token: 'other' })}`
        const client = await createCorePostHog({ ...options, extensions: [toolbar()] })

        expect(toolbarScripts()).toHaveLength(0)
        expect(client.toolbar?.loadToolbar).toBeDefined()
        await client.dispose()
    })

    it('loads explicitly and reports a running toolbar', async () => {
        const client = await createCorePostHog({
            ...options,
            apiHost: 'https://eu.i.posthog.com',
            extensions: [toolbar()],
        })
        expect(client.toolbar?.loadToolbar({ actionId: 3 })).toBe(true)
        expect(toolbarScripts()[0]?.src).toMatch(/^https:\/\/eu-assets\.i\.posthog\.com\/static\/toolbar\.js/)
        finishScriptLoad()
        expect(toolbarWindow.ph_load_toolbar).toHaveBeenCalledWith(
            { token: 'test_token', actionId: 3, apiURL: 'https://eu.posthog.com' },
            undefined
        )

        expect(client.toolbar?.loadToolbar()).toBe(false)
        document.getElementById(TOOLBAR_ID)?.remove()
        expect(client.toolbar?.loadToolbar()).toBe(true)
        // A loaded toolbar script is reused.
        expect(toolbarScripts()).toHaveLength(1)
        expect(toolbarWindow.ph_load_toolbar).toHaveBeenCalledTimes(2)
        await client.dispose()
    })

    it('busts the script cache on a five-minute boundary and honors the asset host override', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(10 * 60 * 1000 + 1234)
        const client = await createCorePostHog({
            ...options,
            extensions: [toolbar({ assetHost: 'https://cdn.example.com/' })],
        })
        client.toolbar?.loadToolbar()
        expect(toolbarScripts()[0]?.src).toMatch(/^https:\/\/cdn\.example\.com\/static\/toolbar\.js\?v=[^&]+&t=600000$/)
        await client.dispose()
    })

    it('disables toolbar metrics only for self-hosted hosts', async () => {
        const selfHosted = await createCorePostHog({
            ...options,
            apiHost: 'https://ph.example.com',
            extensions: [toolbar({ disableMetrics: true })],
        })
        selfHosted.toolbar?.loadToolbar()
        finishScriptLoad()
        expect(toolbarWindow.ph_load_toolbar).toHaveBeenLastCalledWith(
            expect.objectContaining({ instrument: false, apiURL: 'https://ph.example.com' }),
            undefined
        )
        await selfHosted.dispose()
        document.getElementById(TOOLBAR_ID)?.remove()
        localStorage.clear()

        const cloud = await createCorePostHog({ ...options, extensions: [toolbar({ disableMetrics: true })] })
        cloud.toolbar?.loadToolbar()
        expect(toolbarWindow.ph_load_toolbar).toHaveBeenLastCalledWith(
            expect.not.objectContaining({ instrument: false }),
            undefined
        )
        await cloud.dispose()
    })

    it('applies prepareScript and resets the load state after a failure', async () => {
        const prepareScript = vi.fn((script: HTMLScriptElement) => {
            script.nonce = 'abc'
            return script
        })
        const client = await createCorePostHog({ ...options, extensions: [toolbar({ prepareScript })] })
        client.toolbar?.loadToolbar()
        const [script] = toolbarScripts()
        expect(script?.nonce).toBe('abc')
        script?.onerror?.(new Event('error'))
        expect(toolbarWindow.ph_toolbar_state).toBe(0)
        expect(toolbarWindow.ph_load_toolbar).not.toHaveBeenCalled()
        await client.dispose()
    })

    it('handles completion of a script element that prepareScript replaces', async () => {
        const prepareScript = (script: HTMLScriptElement): HTMLScriptElement => {
            const replacement = script.cloneNode() as HTMLScriptElement
            replacement.nonce = 'abc'
            return replacement
        }
        const client = await createCorePostHog({ ...options, extensions: [toolbar({ prepareScript })] })
        client.toolbar?.loadToolbar()
        const failed = toolbarScripts()[0]
        failed?.dispatchEvent(new Event('error'))
        expect(toolbarWindow.ph_toolbar_state).toBe(0)
        failed?.remove()

        client.toolbar?.loadToolbar()
        const [script] = toolbarScripts()
        expect(script?.nonce).toBe('abc')
        script?.dispatchEvent(new Event('load'))
        expect(toolbarWindow.ph_load_toolbar).toHaveBeenCalledTimes(1)
        await client.dispose()
    })

    it('ignores a script that finishes loading after disposal and releases the page-wide load state', async () => {
        const client = await createCorePostHog({ ...options, extensions: [toolbar()] })
        client.toolbar?.loadToolbar()
        expect(toolbarWindow.ph_toolbar_state).toBe(1)

        await client.dispose()
        expect(toolbarWindow.ph_toolbar_state).toBe(0)
        finishScriptLoad()
        expect(toolbarWindow.ph_load_toolbar).not.toHaveBeenCalled()
    })

    it('does not insert a script waiting for the body after disposal', async () => {
        const body = document.body
        document.documentElement.removeChild(body)
        try {
            const client = await createCorePostHog({ ...options, extensions: [toolbar()] })
            expect(client.toolbar?.loadToolbar()).toBe(true)
            await client.dispose()
            expect(toolbarWindow.ph_toolbar_state).toBe(0)
        } finally {
            document.documentElement.appendChild(body)
        }
        document.dispatchEvent(new Event('DOMContentLoaded'))
        expect(toolbarScripts()).toHaveLength(0)
    })

    it('reloads after Turbolinks replaces the page until disposed', async () => {
        const client = await createCorePostHog({ ...options, extensions: [toolbar()] })
        client.toolbar?.loadToolbar()
        finishScriptLoad()
        document.getElementById(TOOLBAR_ID)?.remove()

        window.dispatchEvent(new Event('turbolinks:load'))
        expect(toolbarScripts()).toHaveLength(2)

        await client.dispose()
        delete toolbarWindow.ph_toolbar_state
        window.dispatchEvent(new Event('turbolinks:load'))
        expect(toolbarScripts()).toHaveLength(2)
    })

    it('keeps the pending script when Turbolinks fires its initial page load event', async () => {
        const client = await createCorePostHog({ ...options, extensions: [toolbar()] })
        client.toolbar?.loadToolbar()
        window.dispatchEvent(new Event('turbolinks:load'))
        expect(toolbarScripts()).toHaveLength(1)
        await client.dispose()
    })

    it('keeps a script waiting for the body when Turbolinks fires its initial page load event', async () => {
        const body = document.body
        document.documentElement.removeChild(body)
        const client = await createCorePostHog({ ...options, extensions: [toolbar()] })
        try {
            client.toolbar?.loadToolbar()
        } finally {
            document.documentElement.appendChild(body)
        }
        document.dispatchEvent(new Event('DOMContentLoaded'))
        window.dispatchEvent(new Event('turbolinks:load'))
        expect(toolbarScripts()).toHaveLength(1)
        await client.dispose()
    })

    it('inserts a script into a body Turbolinks replaces while the toolbar loads', async () => {
        const client = await createCorePostHog({ ...options, extensions: [toolbar()] })
        client.toolbar?.loadToolbar()
        const body = document.body
        document.documentElement.replaceChild(document.createElement('body'), body)
        try {
            window.dispatchEvent(new Event('turbolinks:load'))
            expect(toolbarScripts()).toHaveLength(1)
        } finally {
            await client.dispose()
            document.documentElement.replaceChild(body, document.body)
        }
    })

    it('inserts one current script for each Turbolinks body replacement', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(10 * 60 * 1000)
        const client = await createCorePostHog({ ...options, extensions: [toolbar()] })
        client.toolbar?.loadToolbar()
        finishScriptLoad()
        for (let navigation = 1; navigation <= 3; navigation++) {
            vi.setSystemTime((10 + 5 * navigation) * 60 * 1000)
            document.body.replaceChildren()
            window.dispatchEvent(new Event('turbolinks:load'))
            expect(toolbarScripts(), `navigation ${navigation}`).toHaveLength(1)
            expect(toolbarScripts()[0]?.src).toMatch(new RegExp(`&t=${Date.now()}$`))
            finishScriptLoad()
        }
        expect(toolbarWindow.ph_load_toolbar).toHaveBeenCalledTimes(4)
        await client.dispose()
    })
})

describe('automatic toolbar loading', () => {
    it('captures the hash when the client is created and loads the toolbar without delaying initialization', async () => {
        location.hash = `__posthog=${encodeState(authorizeState)}`
        const pending = createRootPostHog({ ...options, flags: false })
        // An application router replaces the hash after the client starts.
        history.replaceState(null, '', '/page')
        const client = await pending

        await vi.waitFor(() => expect(client.toolbar).toBeDefined())
        expect(toolbarScripts()).toHaveLength(1)
        await client.dispose()
    })

    it.each([
        ['a parameter that only ends in state', `filterstate=${encodeState(authorizeState)}`],
        ['an OAuth redirect state', 'access_token=abc&state=xyz123&token_type=bearer'],
        ['a state that is not a toolbar authorization', `state=${encodeState({ ...authorizeState, action: 'other' })}`],
    ])('does not load the toolbar for %s', async (_name, hash) => {
        location.hash = hash
        const client = await createRootPostHog({ ...options, flags: false })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(client.toolbar).toBeUndefined()
        expect(location.hash).toBe(`#${hash}`)
        await client.dispose()
    })

    it('loads the toolbar for a legacy url-encoded authorization state', async () => {
        location.hash = `access_token=abc&state=${encodeURIComponent(JSON.stringify(authorizeState))}`
        const client = await createRootPostHog({ ...options, flags: false })

        await vi.waitFor(() => expect(client.toolbar).toBeDefined())
        expect(toolbarScripts()).toHaveLength(1)
        await client.dispose()
    })

    it('loads from saved parameters and stays unloaded without a signal', async () => {
        const idle = await createRootPostHog({ ...options, flags: false })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(idle.toolbar).toBeUndefined()
        await idle.dispose()

        localStorage.setItem('_postHogToolbarParams', JSON.stringify({ token: 'test_token' }))
        const client = await createRootPostHog({ ...options, flags: false })
        await vi.waitFor(() => expect(client.toolbar).toBeDefined())
        expect(toolbarScripts()).toHaveLength(1)
        await client.dispose()
    })

    it('can be disabled or resolved explicitly', async () => {
        localStorage.setItem('_postHogToolbarParams', JSON.stringify({ token: 'test_token' }))
        const disabled = await createRootPostHog({ ...options, flags: false, toolbar: false })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(disabled.toolbar).toBeUndefined()
        expect(await disabled.resolveExtension('toolbar')).toBeUndefined()
        await disabled.dispose()

        localStorage.clear()
        const client = await createRootPostHog({
            ...options,
            flags: false,
            uiHost: 'https://ui.example.com',
            toolbar: {},
        })
        const resolved = await client.resolveExtension('toolbar')
        expect(resolved?.loadToolbar()).toBe(true)
        finishScriptLoad()
        expect(toolbarWindow.ph_load_toolbar).toHaveBeenCalledWith(
            expect.objectContaining({ apiURL: 'https://ui.example.com' }),
            undefined
        )
        await client.dispose()
    })
})

describe('getUiHost', () => {
    it.each([
        ['https://us.i.posthog.com', 'https://us.posthog.com'],
        ['https://eu.i.posthog.com', 'https://eu.posthog.com'],
        ['https://app.posthog.com', 'https://us.posthog.com'],
        ['https://ph.example.com/ingest', 'https://ph.example.com/ingest'],
    ])('maps %s to %s', (apiHost, uiHost) => {
        expect(getUiHost(undefined, apiHost)).toBe(uiHost)
    })

    it('prefers the configured host, mapped as in posthog-js', () => {
        expect(getUiHost('https://ui.example.com/', 'https://us.i.posthog.com')).toBe('https://ui.example.com')
        expect(getUiHost('https://app.posthog.com', 'https://eu.i.posthog.com')).toBe('https://us.posthog.com')
    })
})

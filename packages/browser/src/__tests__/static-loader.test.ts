import { version } from '../../package.json'
import { AssignableWindow } from '../utils/globals'

const loaderWindow = window as AssignableWindow

const load = () => import('../entrypoints/loader')

const injectedScripts = () => Array.from(document.querySelectorAll<HTMLScriptElement>('script:not([data-loader-test])'))

describe('static script loader', () => {
    let script: HTMLScriptElement

    beforeEach(() => {
        vi.resetModules()
        loaderWindow.posthog = undefined
        loaderWindow.POSTHOG_DEBUG = true
        document.head.innerHTML = ''
        script = document.createElement('script')
        script.src = 'https://us-assets.i.posthog.com/static/loader.js'
        script.setAttribute('data-loader-test', '')
        script.setAttribute('data-project-token', 'phc_test')
        document.head.appendChild(script)
        vi.spyOn(document, 'currentScript', 'get').mockReturnValue(script)
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
        loaderWindow.posthog = undefined
        Reflect.deleteProperty(loaderWindow, 'POSTHOG_DEBUG')
        document.head.innerHTML = ''
    })

    it.each(['us', 'eu'])('initializes the %s region and exposes queued methods synchronously', async (region) => {
        script.src = `https://${region}-assets.i.posthog.com/static/loader.js`

        await load()

        const ph = loaderWindow.posthog
        expect(ph.__SV).toBe(1)
        expect(ph._i).toEqual([['phc_test', { api_host: `https://${region}.i.posthog.com` }, 'posthog']])
        expect(ph._i[0][1]).not.toHaveProperty('defaults')
        ph.identify('user')
        ph.capture('queued event', { value: 1 })
        ph.onFeatureFlags(() => {})
        expect(ph.slice(0, 2)).toEqual([
            ['identify', 'user'],
            ['capture', 'queued event', { value: 1 }],
        ])
        expect(ph[2][0]).toBe('onFeatureFlags')
        expect(ph.people.slice()).toEqual([])
        expect(ph.toString()).toBe('posthog (stub)')
        expect(ph.people.toString()).toBe('posthog.people (stub)')
        const [core] = injectedScripts()
        expect(injectedScripts()).toHaveLength(1)
        expect(core.src).toBe(`https://${region}-assets.i.posthog.com/static/${version}/array.js`)
        expect(core.async).toBe(true)
        expect(core.crossOrigin).toBe('anonymous')
    })

    it.each([undefined, 'false'])('keeps automatic initialization when data-defer-init is %j', async (value) => {
        if (value) {
            script.setAttribute('data-defer-init', value)
        }
        await load()
        expect(loaderWindow.posthog._i).toHaveLength(1)
        expect(loaderWindow.posthog._i[0][0]).toBe('phc_test')
    })

    it('downloads the SDK without initialization and queues an explicit init call', async () => {
        script.src = 'https://customer.example/ingest/static/loader.js'
        script.removeAttribute('data-project-token')
        script.setAttribute('data-defer-init', 'true')
        await load()
        const ph = loaderWindow.posthog
        expect(ph._i).toEqual([])
        expect(injectedScripts()[0].src).toBe(`https://customer.example/ingest/static/${version}/array.js`)
        const beforeSend = vi.fn()
        const config = { api_host: '/ingest', before_send: beforeSend }
        expect(ph.init('phc_manual', config)).toBe(ph)
        ph.capture('after manual init')
        expect(ph._i).toEqual([['phc_manual', config, 'posthog']])
        expect(ph.slice()).toEqual([['capture', 'after manual init']])
    })

    it.each([false, true])('keeps named initialization queues separate with deferred mode %j', async (deferInit) => {
        script.setAttribute('data-defer-init', String(deferInit))
        await load()
        const ph = loaderWindow.posthog
        const first = ph.init('phc_named', {}, 'secondary')
        first.capture('first named event')
        const second = ph.init('phc_named', {}, 'secondary')
        second.people.set({ plan: 'paid' })
        expect(second).toBe(first)
        expect(ph.secondary).toBe(first)
        if (!deferInit) {
            expect(ph._i[0]).toEqual(['phc_test', { api_host: 'https://us.i.posthog.com' }, 'posthog'])
        }
        expect(ph._i.slice(deferInit ? 0 : 1)).toEqual([
            ['phc_named', {}, 'secondary'],
            ['phc_named', {}, 'secondary'],
        ])
        expect(ph.slice()).toEqual([])
        expect(first.slice()).toEqual([['capture', 'first named event']])
        expect(first.people.slice()).toEqual([['set', { plan: 'paid' }]])
        expect(first.toString()).toBe('posthog.secondary (stub)')
        expect(first.people.toString()).toBe('posthog.secondary.people (stub)')
    })

    it.each(['onSurveysLoaded', 'captureTraceMetric'])(
        'queues the public %s method before the SDK loads',
        async (method) => {
            await load()
            const args = method === 'onSurveysLoaded' ? [vi.fn()] : ['trace-id', 'score', 0.9]
            loaderWindow.posthog[method](...args)
            expect(loaderWindow.posthog.slice()).toEqual([[method, ...args]])
        }
    )

    it.each(['set', 'set_once'])('queues people.%s separately from top-level calls', async (method) => {
        await load()
        loaderWindow.posthog.people[method]({ plan: 'paid' })
        expect(loaderWindow.posthog.people.slice()).toEqual([[method, { plan: 'paid' }]])
        expect(loaderWindow.posthog.slice()).toEqual([])
    })

    it.each([
        ['a missing token', (element: HTMLScriptElement) => element.removeAttribute('data-project-token')],
        ['malformed JSON', (element: HTMLScriptElement) => element.setAttribute('data-config', '{')],
        ['non-object JSON', (element: HTMLScriptElement) => element.setAttribute('data-config', 'null')],
        ['an unknown host', (element: HTMLScriptElement) => (element.src = 'https://customer.example/loader.js')],
    ] as const)('reports %s without debug mode', async (_name, configure) => {
        Reflect.deleteProperty(loaderWindow, 'POSTHOG_DEBUG')
        configure(script)
        await load()
        expect(console.error).toHaveBeenCalled()
        expect(loaderWindow.posthog).toBeUndefined()
        expect(injectedScripts()).toHaveLength(0)
    })

    it('reads and decodes the project token from the script URL without forwarding its query to the core', async () => {
        script.removeAttribute('data-project-token')
        script.src = 'https://us-assets.i.posthog.com/static/loader.js?cache=1&project_token=%20phc%5Furl%20'
        await load()
        expect(loaderWindow.posthog._i[0][0]).toBe('phc_url')
        expect(injectedScripts()[0].src).toBe(`https://us-assets.i.posthog.com/static/${version}/array.js`)
    })

    it('prefers the URL token over the attribute fallback', async () => {
        script.src += '?project_token=phc_url'
        await load()
        expect(loaderWindow.posthog._i[0][0]).toBe('phc_url')
    })

    it('uses the attribute fallback when the query token is empty', async () => {
        script.src += '?project_token='
        await load()
        expect(loaderWindow.posthog._i[0][0]).toBe('phc_test')
    })

    it('does not read a token from the URL fragment or another query parameter', async () => {
        script.removeAttribute('data-project-token')
        script.src += '?other_project_token=phc_wrong#project_token=phc_fragment'
        await load()
        expect(loaderWindow.posthog).toBeUndefined()
        expect(injectedScripts()).toHaveLength(0)
    })

    it.each([
        ['1', version],
        ['1.438.21', '1.438.21'],
        ['1.438.22-beta.1', '1.438.22-beta.1'],
    ])('loads an immutable core from the %s loader namespace', async (loaderVersion, coreVersion) => {
        script.src = `https://eu-assets.i.posthog.com/static/${loaderVersion}/loader.js?cache=1#fragment`
        await load()
        expect(injectedScripts()[0].src).toBe(`https://eu-assets.i.posthog.com/static/${coreVersion}/array.js`)
    })

    it('preserves proxy paths and accepts an explicit ingestion host', async () => {
        script.src = 'https://customer.example/ingest/static/loader.js'
        script.setAttribute('data-api-host', '/ingest')
        await load()
        expect(loaderWindow.posthog._i[0][1].api_host).toBe('/ingest')
        expect(injectedScripts()[0].src).toBe(`https://customer.example/ingest/static/${version}/array.js`)
    })

    it.each([
        ['ingest/static/1', `ingest/static/${version}`],
        ['proxy/2026/static', `proxy/2026/static/${version}`],
        ['assets/123', `assets/123/${version}`],
    ])('preserves the proxy prefix for %s', async (loaderDirectory, coreDirectory) => {
        script.src = `https://customer.example/${loaderDirectory}/loader.js`
        script.setAttribute('data-api-host', '/ingest')
        await load()
        expect(injectedScripts()[0].src).toBe(`https://customer.example/${coreDirectory}/array.js`)
    })

    it('applies configuration before queuing initialization, with explicit attributes taking precedence', async () => {
        script.setAttribute(
            'data-config',
            JSON.stringify({
                api_host: 'https://other.example',
                defaults: '2026-01-30',
                opt_out_capturing_by_default: true,
                disable_session_recording: true,
                bootstrap: { distinctID: 'bootstrapped-user' },
            })
        )
        script.setAttribute('data-api-host', 'https://proxy.example')
        script.setAttribute('data-defaults', '2025-11-30')
        script.setAttribute('data-project-token', '  phc_trimmed  ')
        await load()
        expect(loaderWindow.posthog._i).toEqual([
            [
                'phc_trimmed',
                {
                    api_host: 'https://proxy.example',
                    defaults: '2025-11-30',
                    opt_out_capturing_by_default: true,
                    disable_session_recording: true,
                    bootstrap: { distinctID: 'bootstrapped-user' },
                },
                'posthog',
            ],
        ])
    })

    it('accepts the ingestion host and defaults from JSON configuration', async () => {
        script.src = 'https://customer.example/static/loader.js'
        script.setAttribute('data-config', '{"api_host":"/ingest","defaults":"2026-01-30"}')
        await load()
        expect(loaderWindow.posthog._i[0][1]).toEqual({ api_host: '/ingest', defaults: '2026-01-30' })
    })

    it.each(['data-defaults', 'data-config'])('preserves an explicit unset snapshot from %s', async (attribute) => {
        script.setAttribute(attribute, attribute === 'data-defaults' ? 'unset' : '{"defaults":"unset"}')
        await load()
        expect(loaderWindow.posthog._i[0][1].defaults).toBe('unset')
    })

    it('propagates a CSP nonce to the injected script', async () => {
        script.nonce = 'test-nonce'
        await load()
        expect(injectedScripts()[0].nonce).toBe('test-nonce')
    })

    it('applies a customer-pinned SHA-384 hash to the downloaded core', async () => {
        const integrity = 'sha384-' + 'A'.repeat(64)
        script.setAttribute('data-core-integrity', integrity)
        await load()
        expect(injectedScripts()[0].integrity).toBe(integrity)
        expect(injectedScripts()[0].crossOrigin).toBe('anonymous')
    })

    it.each(['', ' ', 'not-a-hash', 'sha384-short', 'sha384-' + 'A'.repeat(63), 'sha384-' + '!'.repeat(64)])(
        'rejects invalid core integrity %j without creating an unprotected script',
        async (integrity) => {
            script.setAttribute('data-core-integrity', integrity)
            await load()
            expect(injectedScripts()).toHaveLength(0)
            expect(loaderWindow.posthog).toBeUndefined()
            expect(console.error).toHaveBeenCalled()
        }
    )

    it('also enforces core integrity in deferred initialization mode', async () => {
        const integrity = 'sha384-' + 'B'.repeat(64)
        script.setAttribute('data-defer-init', 'true')
        script.setAttribute('data-core-integrity', integrity)
        await load()
        expect(injectedScripts()[0].integrity).toBe(integrity)
    })

    it.each(['{', 'null', '[]', 'true', '"string"'])(
        'does not initialize with invalid JSON config %s',
        async (config) => {
            script.setAttribute('data-config', config)
            await load()
            expect(loaderWindow.posthog).toBeUndefined()
            expect(injectedScripts()).toHaveLength(0)
            expect(console.error).toHaveBeenCalled()
        }
    )

    it.each(['', '   '])('does not initialize without a project token (%j)', async (token) => {
        script.setAttribute('data-project-token', token)
        await load()
        expect(loaderWindow.posthog).toBeUndefined()
        expect(injectedScripts()).toHaveLength(0)
        expect(console.error).toHaveBeenCalled()
    })

    it('requires an explicit ingestion host on an unrecognized asset host', async () => {
        script.src = 'https://customer.example/static/loader.js'
        await load()
        expect(loaderWindow.posthog).toBeUndefined()
        expect(injectedScripts()).toHaveLength(0)
        expect(console.error).toHaveBeenCalled()
    })

    it('does nothing without an executing script element', async () => {
        vi.spyOn(document, 'currentScript', 'get').mockReturnValue(null)
        await load()
        expect(loaderWindow.posthog).toBeUndefined()
        expect(injectedScripts()).toHaveLength(0)
    })

    it.each([
        { __SV: 1, _i: [['legacy_token', {}, 'posthog']] },
        { init: vi.fn(), __loaded: true },
    ])('leaves an existing legacy stub or live SDK untouched', async (existing) => {
        loaderWindow.posthog = existing
        await load()
        expect(loaderWindow.posthog).toBe(existing)
        expect(injectedScripts()).toHaveLength(0)
    })

    it('does not reinitialize or inject a second core when executed twice', async () => {
        await load()
        const first = loaderWindow.posthog
        first.capture('queued once')
        vi.resetModules()
        script.setAttribute('data-project-token', 'phc_other')
        await load()
        expect(loaderWindow.posthog).toBe(first)
        expect(first._i).toHaveLength(1)
        expect(first[0]).toEqual(['capture', 'queued once'])
        expect(injectedScripts()).toHaveLength(1)
    })

    it('supports a read-only inherited toString', async () => {
        const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'toString')!
        Object.defineProperty(Array.prototype, 'toString', { ...descriptor, writable: false })
        try {
            await load()
            expect(loaderWindow.posthog.toString()).toBe('posthog (stub)')
            expect(loaderWindow.posthog.people.toString()).toBe('posthog.people (stub)')
        } finally {
            Object.defineProperty(Array.prototype, 'toString', descriptor)
        }
    })
})

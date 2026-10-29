import { isNull } from '@posthog/core'
import { version } from '../../package.json'
import { AssignableWindow } from '../utils/globals'

const loaderWindow = window as AssignableWindow
const bootstrap = () => import('../entrypoints/loader-bootstrap')

describe('local loader bootstrap', () => {
    let script: HTMLScriptElement

    beforeEach(() => {
        vi.resetModules()
        loaderWindow.posthog = undefined
        document.head.innerHTML = ''
        script = document.createElement('script')
        script.src = '/scripts/posthog-bootstrap.js'
        script.setAttribute('data-asset-host', 'https://us-assets.i.posthog.com')
        document.head.appendChild(script)
        vi.spyOn(document, 'currentScript', 'get').mockReturnValue(script)
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
        loaderWindow.posthog = undefined
        document.head.innerHTML = ''
    })

    const injectedCore = () => document.querySelector<HTMLScriptElement>('script[src$="array.js"]')!

    it('downloads the matching SDK directly without a hosted-loader request', async () => {
        await bootstrap()
        const downloads = Array.from(document.querySelectorAll<HTMLScriptElement>('script'))
            .filter((element) => element !== script)
            .map((element) => element.src)
        expect(downloads).toEqual([`https://us-assets.i.posthog.com/static/${version}/array.js`])
        expect(injectedCore().async).toBe(true)
        expect(injectedCore().crossOrigin).toBe('anonymous')
    })

    it('reports copied token-bearing script URLs instead of silently ignoring their token', async () => {
        script.setAttribute(
            'data-asset-host',
            'https://us-assets.i.posthog.com/static/loader.js?project_token=phc_wrong'
        )
        await bootstrap()
        expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('posthog.init()'))
        expect(console.error).not.toHaveBeenCalledWith(expect.any(String), expect.stringContaining('phc_wrong'))
        expect(loaderWindow.posthog).toBeUndefined()
        expect(document.querySelectorAll('script')).toHaveLength(1)
    })

    it('exposes generated methods before the SDK downloads', async () => {
        await bootstrap()
        const ph = loaderWindow.posthog
        expect(ph.__loaded).toBeUndefined()
        expect(ph._i).toEqual([])
        ph.capture('early event')
        ph.onSurveysLoaded(vi.fn())
        ph.captureTraceMetric('trace-id', 'score', 0.9)
        ph.people.set({ plan: 'paid' })
        expect(ph.slice().map((call: unknown[]) => call[0])).toEqual([
            'capture',
            'onSurveysLoaded',
            'captureTraceMetric',
        ])
        expect(ph.people.slice()).toEqual([['set', { plan: 'paid' }]])
    })

    it.each([
        ['https://eu-assets.i.posthog.com', `https://eu-assets.i.posthog.com/static/${version}/array.js`],
        [' https://us-assets.i.posthog.com/ ', `https://us-assets.i.posthog.com/static/${version}/array.js`],
        ['https://proxy.example/ingest', `https://proxy.example/ingest/static/${version}/array.js`],
        ['https://proxy.example/ingest/', `https://proxy.example/ingest/static/${version}/array.js`],
        ['/ingest', `http://localhost/ingest/static/${version}/array.js`],
        ['http://proxy.example:8080/ingest', `http://proxy.example:8080/ingest/static/${version}/array.js`],
        ['/static-proxy', `http://localhost/static-proxy/static/${version}/array.js`],
        ['/', `http://localhost/static/${version}/array.js`],
    ])('loads the bootstrap release from asset host %s', async (source, expected) => {
        script.setAttribute('data-asset-host', source)
        await bootstrap()
        expect(injectedCore().src).toBe(expected)
    })

    it('preserves primary and named queues with function-valued configuration while the SDK downloads', async () => {
        await bootstrap()
        const ph = loaderWindow.posthog
        const beforeSend = vi.fn((event) => event)
        const config = { api_host: '/ingest', before_send: beforeSend, opt_out_capturing_by_default: true }
        expect(ph.init('phc_primary', config)).toBe(ph)
        ph.register({ queued: true })
        ph.capture('early event')
        const secondary = ph.init('phc_secondary', config, 'secondary')
        secondary.capture('named event')
        secondary.people.set_once({ plan: 'paid' })

        expect(loaderWindow.posthog).toBe(ph)
        expect(ph.secondary).toBe(secondary)
        expect(ph._i).toEqual([
            ['phc_primary', config, 'posthog'],
            ['phc_secondary', config, 'secondary'],
        ])
        expect(ph._i[0][1].before_send).toBe(beforeSend)
        expect(ph.slice()).toEqual([
            ['register', { queued: true }],
            ['capture', 'early event'],
        ])
        expect(secondary.slice()).toEqual([['capture', 'named event']])
        expect(secondary.people.slice()).toEqual([['set_once', { plan: 'paid' }]])
    })

    it('passes the CSP nonce to the asynchronous SDK download', async () => {
        script.nonce = 'bootstrap-nonce'
        await bootstrap()
        expect(injectedCore().nonce).toBe('bootstrap-nonce')
    })

    it('does not replace a pending queue or download another SDK when executed twice', async () => {
        await bootstrap()
        const ph = loaderWindow.posthog
        ph.init('phc_test', {})
        ph.capture('queued once')
        vi.resetModules()
        await bootstrap()
        expect(loaderWindow.posthog).toBe(ph)
        expect(ph.slice()).toEqual([['capture', 'queued once']])
        expect(ph._i).toHaveLength(1)
        expect(document.querySelectorAll('script')).toHaveLength(2)
    })

    it.each([{ __SV: 1 }, { init: vi.fn(), __loaded: true }])(
        'leaves an existing snippet or live SDK untouched',
        async (existing) => {
            loaderWindow.posthog = existing
            await bootstrap()
            expect(loaderWindow.posthog).toBe(existing)
            expect(document.querySelectorAll('script')).toHaveLength(1)
        }
    )

    it.each([null, '', '   '])('reports a missing asset host (%j) without creating a queue', async (source) => {
        if (isNull(source)) script.removeAttribute('data-asset-host')
        else script.setAttribute('data-asset-host', source)
        await bootstrap()
        expect(console.error).toHaveBeenCalledWith(expect.any(String), 'Missing data-asset-host')
        expect(loaderWindow.posthog).toBeUndefined()
        expect(document.querySelectorAll('script')).toHaveLength(1)
    })

    it.each([
        'https://us-assets.i.posthog.com/static/loader.js',
        'https://us-assets.i.posthog.com?cache=1',
        'https://us-assets.i.posthog.com#fragment',
        'javascript:void(0)',
        'us-assets.i.posthog.com',
        'ingest',
        'https://us-assets.i.posthog.com/static',
        'https://us-assets.i.posthog.com/static/1',
        '/static/1',
        'https://proxy.example/ingest/static/1.441.2',
    ])('reports invalid asset host %s without injecting a script', async (source) => {
        script.setAttribute('data-asset-host', source)
        await bootstrap()
        expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('posthog.init()'))
        expect(loaderWindow.posthog).toBeUndefined()
        expect(document.querySelectorAll('script')).toHaveLength(1)
    })

    it('does nothing without an executing script', async () => {
        vi.spyOn(document, 'currentScript', 'get').mockReturnValue(null)
        await bootstrap()
        expect(loaderWindow.posthog).toBeUndefined()
        expect(document.querySelectorAll('script')).toHaveLength(1)
    })
})

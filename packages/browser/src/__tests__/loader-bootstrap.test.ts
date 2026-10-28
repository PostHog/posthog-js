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
        script.setAttribute('data-loader-src', 'https://us-assets.i.posthog.com/static/1/loader.js')
        document.head.appendChild(script)
        vi.spyOn(document, 'currentScript', 'get').mockReturnValue(script)
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
        loaderWindow.posthog = undefined
        document.head.innerHTML = ''
    })

    const hostedLoader = () => document.querySelector<HTMLScriptElement>('script[data-defer-init]')!

    it('exposes generated methods before the asynchronous hosted loader downloads', async () => {
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
        expect(hostedLoader().src).toBe(`https://us-assets.i.posthog.com/static/${version}/loader.js`)
        expect(hostedLoader().async).toBe(true)
        expect(hostedLoader().crossOrigin).toBe('anonymous')
        expect(document.querySelectorAll('script')).toHaveLength(2)
    })

    it.each([
        [
            'https://eu-assets.i.posthog.com/static/loader.js?cache=1#hash',
            `https://eu-assets.i.posthog.com/static/${version}/loader.js`,
        ],
        ['https://proxy.example/ingest/static/1/loader.js', `https://proxy.example/ingest/static/${version}/loader.js`],
        [
            'https://us-assets.i.posthog.com/static/1.500.0/loader.js',
            'https://us-assets.i.posthog.com/static/1.500.0/loader.js',
        ],
    ])('resolves %s to a versioned loader', async (source, expected) => {
        script.setAttribute('data-loader-src', source)
        await bootstrap()
        expect(hostedLoader().src).toBe(expected)
    })

    it('hands off the same primary and named queues with function-valued configuration', async () => {
        await bootstrap()
        const ph = loaderWindow.posthog
        const beforeSend = vi.fn((event) => event)
        const config = { api_host: '/ingest', before_send: beforeSend, opt_out_capturing_by_default: true }
        expect(ph.init('phc_primary', config)).toBe(ph)
        ph.register({ queued: true })
        ph.capture('before loader')
        const secondary = ph.init('phc_secondary', config, 'secondary')
        secondary.capture('named event')
        secondary.people.set_once({ plan: 'paid' })

        const loader = hostedLoader()
        vi.spyOn(document, 'currentScript', 'get').mockReturnValue(loader)
        await import('../entrypoints/loader')

        expect(loaderWindow.posthog).toBe(ph)
        expect(ph.secondary).toBe(secondary)
        expect(ph._i).toEqual([
            ['phc_primary', config, 'posthog'],
            ['phc_secondary', config, 'secondary'],
        ])
        expect(ph._i[0][1].before_send).toBe(beforeSend)
        expect(ph.slice()).toEqual([
            ['register', { queued: true }],
            ['capture', 'before loader'],
        ])
        expect(secondary.slice()).toEqual([['capture', 'named event']])
        expect(secondary.people.slice()).toEqual([['set_once', { plan: 'paid' }]])
        const core = document.querySelector<HTMLScriptElement>('script[src$="array.js"]')!
        expect(core.src).toBe(`https://us-assets.i.posthog.com/static/${version}/array.js`)
        expect(core.async).toBe(true)
        ph.capture('during core download')
        expect(ph[2]).toEqual(['capture', 'during core download'])
    })

    it('passes the CSP nonce through both asynchronous downloads', async () => {
        script.nonce = 'bootstrap-nonce'
        await bootstrap()
        const loader = hostedLoader()
        expect(loader.nonce).toBe('bootstrap-nonce')
        vi.spyOn(document, 'currentScript', 'get').mockReturnValue(loader)
        await import('../entrypoints/loader')
        expect(document.querySelector<HTMLScriptElement>('script[src$="array.js"]')!.nonce).toBe('bootstrap-nonce')
    })

    it('does not replace a pending queue or download another loader when executed twice', async () => {
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

    it.each([null, '', '   '])('reports a missing loader URL (%j) without creating a queue', async (source) => {
        if (isNull(source)) script.removeAttribute('data-loader-src')
        else script.setAttribute('data-loader-src', source)
        await bootstrap()
        expect(console.error).toHaveBeenCalled()
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

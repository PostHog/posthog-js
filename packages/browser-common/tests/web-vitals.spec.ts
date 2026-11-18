import { WEB_VITALS_ENABLED_SERVER_SIDE } from '../src/constants'
import type { RemoteConfig } from '../src/types/remote-config'
import { WebVitalsAutocapture } from '../src/web-vitals'
import { createTestClient } from './helpers/test-client'

const { location } = vi.hoisted(() => ({ location: { protocol: '' } }))
vi.mock('../src/utils/globals', () => ({ location }))

describe('web-vitals protocol gating', () => {
    it.each([
        // hybrid app tools
        'capacitor',
        'capacitor-electron',
        'tauri',
        'ionic',
        'wails',
        'android-app',
        'ms-appx-web',
        // browser extensions
        'chrome',
        'chrome-extension',
        'moz-extension',
        'safari-web-extension',
        'vscode-webview',
        // local files
        'file',
        'blob',
        'data',
        'content',
        'dfile',
        'javascript',
        'about',
        'localhost',
        // email clients
        'ms-outlook',
        'email',
        // misc
        'ws',
        'wss',
        'ftp',
        'unknown',
    ])('does not enable on %s', (protocol) => {
        location.protocol = protocol + ':'
        const webVitals = new WebVitalsAutocapture({
            getConfig: () => ({ capture_performance: true }),
            loadObservers: vi.fn(),
        })

        expect(webVitals.isEnabled).toBe(false)
    })

    it.each(['http', 'https'])('enables on %s', (protocol) => {
        location.protocol = protocol + ':'
        const webVitals = new WebVitalsAutocapture({
            getConfig: () => ({ capture_performance: true }),
            loadObservers: vi.fn(),
        })

        expect(webVitals.isEnabled).toBe(true)
    })
})

describe('web-vitals remote enablement', () => {
    const observers = () => ({ onLCP: vi.fn(), onCLS: vi.fn(), onFCP: vi.fn(), onINP: vi.fn() })
    const remoteConfig = (webVitals: boolean) =>
        ({ capturePerformance: { web_vitals: webVitals } }) as unknown as RemoteConfig

    beforeEach(() => {
        location.protocol = 'https:'
    })

    it('does not start from a saved hint that a replayed remote config turns off', () => {
        const client = createTestClient({ remoteConfig: remoteConfig(false) })
        client.kv.set(WEB_VITALS_ENABLED_SERVER_SIDE, true)
        const loadObservers = vi.fn()
        new WebVitalsAutocapture({ getConfig: () => ({}), loadObservers }).setup(client)

        expect(loadObservers).not.toHaveBeenCalled()
        expect(client.kv.get(WEB_VITALS_ENABLED_SERVER_SIDE)).toBe(false)
    })

    it('loads once when both the saved hint and a replayed remote config enable it', () => {
        const client = createTestClient({ remoteConfig: remoteConfig(true) })
        client.kv.set(WEB_VITALS_ENABLED_SERVER_SIDE, true)
        const loadObservers = vi.fn()
        new WebVitalsAutocapture({ getConfig: () => ({}), loadObservers }).setup(client)

        expect(loadObservers).toHaveBeenCalledOnce()
    })

    it('does not register observers when remote config turns capture off while they load', () => {
        const client = createTestClient()
        client.kv.set(WEB_VITALS_ENABLED_SERVER_SIDE, true)
        let finishLoading: (() => void) | undefined
        const callbacks = observers()
        new WebVitalsAutocapture({
            getConfig: () => ({}),
            loadObservers: (_getFlavor, onLoad) => {
                finishLoading = () => onLoad(callbacks)
            },
        }).setup(client)

        client.setRemoteConfig(remoteConfig(false))
        finishLoading?.()

        expect(finishLoading).toBeDefined()
        expect(callbacks.onLCP).not.toHaveBeenCalled()
        expect(callbacks.onCLS).not.toHaveBeenCalled()
    })
})

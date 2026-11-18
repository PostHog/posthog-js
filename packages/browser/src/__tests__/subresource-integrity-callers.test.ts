import '../entrypoints/default-extensions'
import '../entrypoints/external-scripts-loader'

import { PostHog } from '../posthog-core'
import { assignableWindow } from '../utils/globals'
import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { SDK_DEBUG_RECORDING_SCRIPT_NOT_LOADED } from '../constants'
import { createRemoteConfig } from './helpers/posthog-instance'
import { getBundledExtensionLoader, setBundledExtensionLoader } from '../utils/extension-loader'

// The unbuilt source has placeholders only, so every unpinned extension fails closed: this
// exercises each caller's handling of a refused load without any hashes available.
describe('require_subresource_integrity callers', () => {
    let consoleError: ReturnType<typeof vi.spyOn>
    let consoleWarn: ReturnType<typeof vi.spyOn>
    const loader = getBundledExtensionLoader()!
    let bundledLoader: ReturnType<typeof vi.fn>
    const siteAppLoader = assignableWindow.__PosthogExtensions__.loadSiteApp!

    beforeEach(() => {
        vi.useFakeTimers()
        document.head.innerHTML = ''
        document.body.innerHTML = ''
        consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        bundledLoader = vi.fn(loader)
        setBundledExtensionLoader(bundledLoader)
        assignableWindow.__PosthogExtensions__.loadExternalDependency = loader
        assignableWindow.__PosthogExtensions__.loadSiteApp = vi.fn(siteAppLoader)
        assignableWindow._POSTHOG_REMOTE_CONFIG = undefined
    })

    afterEach(() => {
        vi.useRealTimers()
        setBundledExtensionLoader(loader)
        assignableWindow.__PosthogExtensions__.loadExternalDependency = loader
        assignableWindow.__PosthogExtensions__.loadSiteApp = siteAppLoader
        consoleError.mockRestore()
        consoleWarn.mockRestore()
    })

    const init = (config: Record<string, unknown> = {}, remoteConfig?: Parameters<typeof createRemoteConfig>[0]) => {
        const token = uuidv7()
        if (remoteConfig) {
            assignableWindow._POSTHOG_REMOTE_CONFIG = {
                [token]: { config: createRemoteConfig(remoteConfig), siteApps: [] },
            }
        }
        const onCapture = vi.fn()
        const posthog = new PostHog().init(
            token,
            {
                api_host: 'https://us.i.posthog.com',
                require_subresource_integrity: true,
                request_batching: false,
                persistence: 'memory',
                before_send: (event) => {
                    onCapture(event)
                    return null
                },
                ...config,
            },
            uuidv7()
        )!
        return { posthog, onCapture }
    }

    const loadedKinds = () => bundledLoader.mock.calls.map(([, kind]) => kind)

    it.each([
        ['without site apps, never requests config.js', false],
        ['with opt_in_site_apps, refuses config.js', true],
    ])('loads remote config as JSON and keeps capturing %s', (_, optInSiteApps) => {
        const sendRequest = vi.spyOn(PostHog.prototype, '_send_request').mockImplementation(({ callback }) => {
            callback?.({ statusCode: 200, json: createRemoteConfig() })
        })
        const { posthog, onCapture } = init({
            advanced_disable_feature_flags: false,
            opt_in_site_apps: optInSiteApps,
        })

        expect(loadedKinds().includes('remote-config')).toBe(optInSiteApps)
        expect(document.getElementsByTagName('script')).toHaveLength(0)
        expect(posthog.__loaded).toBe(true)
        expect(sendRequest).toHaveBeenCalledWith(
            expect.objectContaining({ url: expect.stringContaining(`/array/${posthog.config.token}/config`) })
        )
        expect(() => posthog.capture('after refusal')).not.toThrow()
        expect(onCapture).toHaveBeenCalledWith(expect.objectContaining({ event: 'after refusal' }))
        sendRequest.mockRestore()
    })

    it('disables each lazily loaded feature without throwing or retrying', () => {
        const { posthog, onCapture } = init(
            {
                advanced_disable_flags: true,
                disable_session_recording: false,
                disable_surveys: false,
                capture_dead_clicks: true,
                capture_performance: { web_vitals: true },
                capture_exceptions: true,
                tracing_headers: ['example.com'],
                logs: { captureConsoleLogs: true },
                disable_product_tours: false,
                disable_conversations: false,
                integrations: { intercom: true, crispChat: true },
            },
            {
                sessionRecording: { endpoint: '/s/' },
                surveys: true,
                productTours: true,
                conversations: { enabled: true, token: 'conversations-token' } as any,
                autocaptureExceptions: true,
                capturePerformance: { web_vitals: true },
                logs: { captureConsoleLogs: true } as any,
            }
        )

        const kinds = loadedKinds()
        for (const kind of [
            'lazy-recorder',
            'surveys',
            'dead-clicks-autocapture',
            'web-vitals-with-attribution',
            'logs',
            'conversations',
            'product-tours',
            'exception-autocapture',
            'tracing-headers',
            'intercom-integration',
            'crisp-chat-integration',
        ]) {
            expect(kinds).toContain(kind)
        }
        expect(document.getElementsByTagName('script')).toHaveLength(0)
        expect(() => posthog.capture('still works')).not.toThrow()
        expect(onCapture).toHaveBeenCalledWith(
            expect.objectContaining({
                event: 'still works',
                properties: expect.objectContaining({ [SDK_DEBUG_RECORDING_SCRIPT_NOT_LOADED]: true }),
            })
        )
        vi.advanceTimersByTime(60_000)
        expect(loadedKinds()).toHaveLength(kinds.length)
    })

    it('keeps its own loader when another core replaces the shared global', () => {
        const replacement = vi.fn()
        assignableWindow.__PosthogExtensions__.loadExternalDependency = replacement
        init(
            { advanced_disable_flags: true, disable_session_recording: false, disable_surveys: false },
            { sessionRecording: { endpoint: '/s/' }, surveys: true }
        )

        expect(replacement).not.toHaveBeenCalled()
        expect(loadedKinds()).toEqual(expect.arrayContaining(['lazy-recorder', 'surveys']))
        expect(document.getElementsByTagName('script')).toHaveLength(0)
    })

    it('uses the shared global loader when the option is off', () => {
        const replacement = vi.fn()
        assignableWindow.__PosthogExtensions__.loadExternalDependency = replacement
        init({ require_subresource_integrity: false, advanced_disable_flags: true }, { surveys: true })

        expect(replacement).toHaveBeenCalledWith(expect.anything(), 'surveys', expect.any(Function))
    })

    it('refuses site apps without breaking init', () => {
        const callback = vi.fn()
        const { posthog } = init({ opt_in_site_apps: true, advanced_disable_flags: true })

        assignableWindow.__PosthogExtensions__.loadSiteApp!(posthog, '/site_app/1/token/hash/', callback)

        expect(callback).toHaveBeenCalledWith(expect.stringContaining("Site apps can't be integrity-verified"))
        expect(document.getElementsByTagName('script')).toHaveLength(0)
        expect(posthog.__loaded).toBe(true)
    })

    it('refuses the toolbar and lets it be retried later', () => {
        const { posthog } = init({ advanced_disable_flags: true })
        vi.spyOn(window, 'localStorage', 'get').mockReturnValue({ setItem: vi.fn() } as unknown as Storage)

        expect(posthog.toolbar.loadToolbar({ token: 'toolbar-token', temporaryToken: 'temp' } as any)).toBe(true)

        expect(loadedKinds()).toContain('toolbar')
        expect(document.getElementsByTagName('script')).toHaveLength(0)
        expect(assignableWindow.ph_toolbar_state).toBe(0)
    })
})

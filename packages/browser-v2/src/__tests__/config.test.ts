import { PostHog } from '../posthog-core'
import { DEFAULT_CONTENT_IGNORELIST_WITH_STEPPERS } from '../autocapture-utils'

describe('config', () => {
    describe('default values', () => {
        it('uses the latest defaults without any gating config', () => {
            const posthog = new PostHog()
            posthog._init('test-token')
            expect(posthog.config.capturePageview).toBe('history_change')
            expect(posthog.config.sessionRecording.strictMinimumDuration).toBe(true)
            expect(posthog.config.rageclick).toStrictEqual({
                content_ignorelist: DEFAULT_CONTENT_IGNORELIST_WITH_STEPPERS,
                ignore_text_selection: true,
            })
            expect(posthog.config.externalScriptsInjectTarget).toBe('head')
            expect(posthog.config.internalOrTestUserHostname).toStrictEqual(/^(localhost|127\.0\.0\.1)$/)
            expect(posthog.config.persistenceSaveDebounceMs).toBe(250)
            expect(posthog.config.splitStorage).toBe(true)
            expect(posthog.config.detectGoogleSearchApp).toBe(true)
        })

        it('merges a partial rageclick object with the built-in defaults', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { rageclick: { threshold_px: 50 } })
            expect(posthog.config.rageclick).toStrictEqual({
                content_ignorelist: DEFAULT_CONTENT_IGNORELIST_WITH_STEPPERS,
                ignore_text_selection: true,
                threshold_px: 50,
            })
        })

        it('lets a partial rageclick object override a default sub-option', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { rageclick: { content_ignorelist: false } })
            expect(posthog.config.rageclick).toStrictEqual({
                content_ignorelist: false,
                ignore_text_selection: true,
            })
        })

        it('lets a boolean rageclick replace the default object entirely', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { rageclick: false })
            expect(posthog.config.rageclick).toBe(false)
        })
    })

    describe('external dependency asset config', () => {
        it('defaults supported script asset config options', () => {
            const posthog = new PostHog()
            posthog._init('test-token')

            expect(posthog.config.strictScriptVersioning).toBe(false)
            expect(posthog.config.assetHost).toBeNull()
        })
    })
})

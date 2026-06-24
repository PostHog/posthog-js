import { PostHog } from '../posthog-core'
import type { PostHogConfig } from '../types'
import { DEFAULT_CONTENT_IGNORELIST_WITH_STEPPERS } from '../autocapture-utils'
import { isFunction } from '@posthog/core'

describe('config', () => {
    describe('compatibilityDate', () => {
        it('should set capture_pageview to true when defaults is undefined', () => {
            const posthog = new PostHog()
            posthog._init('test-token')
            expect(posthog.config.capture_pageview).toBe(true)
        })

        it('should set expected values when defaults is 2025-05-24', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { defaults: '2025-05-24' })
            expect(posthog.config.capture_pageview).toBe('history_change')
            expect(posthog.config.session_recording).toStrictEqual({})
            expect(posthog.config.rageclick).toBe(true)
        })

        it('should set expected values when defaults is 2025-11', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { defaults: '2025-11-30' })
            expect(posthog.config.capture_pageview).toBe('history_change')
            expect(posthog.config.session_recording.strictMinimumDuration).toBe(true)
            expect(posthog.config.rageclick).toStrictEqual({ content_ignorelist: true })
        })

        it('should set expected values when defaults is 2026-05-30', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { defaults: '2026-05-30' })
            expect(posthog.config.rageclick).toStrictEqual({
                content_ignorelist: DEFAULT_CONTENT_IGNORELIST_WITH_STEPPERS,
                ignore_text_selection: true,
            })
        })

        it('merges a partial rageclick object with the date-gated defaults', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { defaults: '2026-05-30', rageclick: { threshold_px: 50 } })
            expect(posthog.config.rageclick).toStrictEqual({
                content_ignorelist: DEFAULT_CONTENT_IGNORELIST_WITH_STEPPERS,
                ignore_text_selection: true,
                threshold_px: 50,
            })
        })

        it('lets a partial rageclick object override a default sub-option', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { defaults: '2026-05-30', rageclick: { content_ignorelist: false } })
            expect(posthog.config.rageclick).toStrictEqual({
                content_ignorelist: false,
                ignore_text_selection: true,
            })
        })

        it('lets a boolean rageclick replace the default object entirely', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { defaults: '2026-05-30', rageclick: false })
            expect(posthog.config.rageclick).toBe(false)
        })

        it('keeps date-gated session_recording defaults when the user sets a partial session_recording', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { defaults: '2026-05-30', session_recording: { maskAllInputs: false } })
            expect(posthog.config.session_recording).toStrictEqual({
                strictMinimumDuration: true,
                canvasCapture: { resolutionScale: 0.6 },
                maskAllInputs: false,
            })
        })

        it('lets a user-supplied session_recording sub-option override the date-gated default', () => {
            const posthog = new PostHog()
            posthog._init('test-token', {
                defaults: '2026-06-25',
                session_recording: { canvasCapture: { resolutionScale: 0.8 } },
            })
            expect(posthog.config.session_recording).toStrictEqual({
                strictMinimumDuration: true,
                canvasCapture: { resolutionScale: 0.8 },
                streamNetworkBody: true,
            })
        })

        it.each([
            ['unset', undefined, 0],
            ['2025-05-24', '2025-05-24' as const, 0],
            ['2025-11-30', '2025-11-30' as const, 0],
            ['2026-01-30', '2026-01-30' as const, 0],
            ['2026-05-30', '2026-05-30' as const, 250],
            ['2026-06-25', '2026-06-25' as const, 250],
        ])('persistence_save_debounce_ms with defaults %s', (_label, defaults, expected) => {
            const posthog = new PostHog()
            posthog._init('test-token', defaults ? { defaults } : undefined)
            expect(posthog.config.persistence_save_debounce_ms).toBe(expected)
        })

        it.each([
            ['unset', undefined, false],
            ['2025-05-24', '2025-05-24' as const, false],
            ['2025-11-30', '2025-11-30' as const, false],
            ['2026-01-30', '2026-01-30' as const, false],
            ['2026-05-30', '2026-05-30' as const, true],
            ['2026-06-25', '2026-06-25' as const, true],
        ])('split_storage with defaults %s', (_label, defaults, expected) => {
            const posthog = new PostHog()
            posthog._init('test-token', defaults ? { defaults } : undefined)
            expect(posthog.config.split_storage).toBe(expected)
        })

        it.each([
            ['unset', undefined, false],
            ['2025-05-24', '2025-05-24' as const, false],
            ['2025-11-30', '2025-11-30' as const, false],
            ['2026-01-30', '2026-01-30' as const, false],
            ['2026-05-30', '2026-05-30' as const, true],
            ['2026-06-25', '2026-06-25' as const, true],
        ])('detect_google_search_app with defaults %s', (_label, defaults, expected) => {
            const posthog = new PostHog()
            posthog._init('test-token', defaults ? { defaults } : undefined)
            expect(posthog.config.detect_google_search_app).toBe(expected)
        })

        it.each([
            ['unset', undefined, false],
            ['2025-05-24', '2025-05-24' as const, false],
            ['2025-11-30', '2025-11-30' as const, false],
            ['2026-01-30', '2026-01-30' as const, false],
            ['2026-05-30', '2026-05-30' as const, false],
            ['2026-06-25', '2026-06-25' as const, true],
        ])('disable_capture_url_hashes with defaults %s', (_label, defaults, expected) => {
            const posthog = new PostHog()
            posthog._init('test-token', defaults ? { defaults } : undefined)
            expect(posthog.config.disable_capture_url_hashes).toBe(expected)
        })

        it.each([
            ['unset', undefined, undefined],
            ['2025-05-24', '2025-05-24' as const, undefined],
            ['2025-11-30', '2025-11-30' as const, undefined],
            ['2026-01-30', '2026-01-30' as const, undefined],
            ['2026-05-30', '2026-05-30' as const, undefined],
            ['2026-06-25', '2026-06-25' as const, true],
        ])('session_recording.streamNetworkBody with defaults %s', (_label, defaults, expected) => {
            const posthog = new PostHog()
            posthog._init('test-token', defaults ? { defaults } : undefined)
            expect(posthog.config.session_recording.streamNetworkBody).toBe(expected)
        })

        it('should preserve other default config values when setting defaults', () => {
            const posthog1 = new PostHog()
            posthog1._init('test-token')
            const config1 = { ...posthog1.config }

            const posthog2 = new PostHog()
            posthog2._init('test-token', { defaults: '2025-05-24' })
            const config2 = posthog2.config

            const allKeys = new Set([...Object.keys(config1), ...Object.keys(config2)])
            allKeys.forEach((key) => {
                if (!['capture_pageview', 'defaults'].includes(key)) {
                    const val1 = config1[key as keyof PostHogConfig]
                    const val2 = config2[key as keyof PostHogConfig]
                    if (isFunction(val1)) {
                        expect(isFunction(val2)).toBe(true)
                    } else {
                        expect(val2).toEqual(val1)
                    }
                }
            })
        })
    })

    describe('external dependency asset config', () => {
        it('defaults supported script asset config options', () => {
            const posthog = new PostHog()
            posthog._init('test-token')

            expect(posthog.config.strict_script_versioning).toBe(false)
            expect(posthog.config.asset_host).toBeNull()
        })

        it('maps the deprecated preview boolean option to strict_script_versioning', () => {
            const posthog = new PostHog()
            posthog._init('test-token', {
                __preview_external_dependency_versioned_paths: true,
            })

            expect(posthog.config.strict_script_versioning).toBe(true)
            expect(posthog.config.asset_host).toBeNull()
        })

        it('maps the deprecated preview string option to strict_script_versioning and asset_host', () => {
            const posthog = new PostHog()
            posthog._init('test-token', {
                __preview_external_dependency_versioned_paths: 'https://cdn-preview.example.com/',
            })

            expect(posthog.config.strict_script_versioning).toBe(true)
            expect(posthog.config.asset_host).toBe('https://cdn-preview.example.com/')
        })

        it('lets supported options take precedence over the deprecated preview option', () => {
            const posthog = new PostHog()
            posthog._init('test-token', {
                strict_script_versioning: false,
                asset_host: 'https://cdn.example.com/',
                __preview_external_dependency_versioned_paths: 'https://cdn-preview.example.com/',
            })

            expect(posthog.config.strict_script_versioning).toBe(false)
            expect(posthog.config.asset_host).toBe('https://cdn.example.com/')
        })
    })
})

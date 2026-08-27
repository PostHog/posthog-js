import { PostHog } from '../posthog-core'
import type { PostHogConfig } from '../types'
import { DEFAULT_CONTENT_IGNORELIST_WITH_STEPPERS } from '@posthog/browser-common/utils/autocapture-utils'
import { isFunction } from '@posthog/core'

describe('config', () => {
    describe('memory persistence without bootstrap.distinctID', () => {
        // The warning must reach customers running the default debug:false config, so it goes through
        // console.warn directly rather than logger.warn (which is silent unless debug is enabled). These
        // tests spy on console.warn to prove the message is actually visible.
        let warnSpy: jest.SpyInstance

        beforeEach(() => {
            warnSpy = jest.spyOn(console, 'warn').mockImplementation()
        })

        afterEach(() => {
            warnSpy.mockRestore()
        })

        it.each(['memory', 'sessionStorage'] as const)(
            "warns when persistence is '%s' and no bootstrap.distinctID is set",
            (persistence) => {
                new PostHog()._init('test-token', { persistence })
                expect(warnSpy).toHaveBeenCalledWith('[PostHog.js]', expect.stringContaining('bootstrap.distinctID'))
            }
        )

        // memory is dropped every load; sessionStorage survives same-tab reloads and only resets per tab/window.
        it.each([
            ['memory', 'on every page load'],
            ['sessionStorage', 'for every new browser tab or window'],
        ] as const)("names the correct distinct-ID lifetime for '%s'", (persistence, lifetime) => {
            new PostHog()._init('test-token', { persistence })
            expect(warnSpy).toHaveBeenCalledWith('[PostHog.js]', expect.stringContaining(lifetime))
        })

        // disable_persistence clears durable identity too, so it hits the same per-load ID-minting failure.
        it('warns when disable_persistence is true and no bootstrap.distinctID is set', () => {
            new PostHog()._init('test-token', { disable_persistence: true })
            expect(warnSpy).toHaveBeenCalledWith(
                '[PostHog.js]',
                expect.stringContaining('persistence is disabled (disable_persistence is true)')
            )
        })

        it('does not warn when disable_persistence is true but bootstrap.distinctID is provided', () => {
            new PostHog()._init('test-token', { disable_persistence: true, bootstrap: { distinctID: 'stable-id' } })
            expect(warnSpy).not.toHaveBeenCalledWith('[PostHog.js]', expect.stringContaining('bootstrap.distinctID'))
        })

        // Cookieless mode registers a stable sentinel instead of a fresh uuid, so the failure does not occur.
        it('does not warn under cookieless mode even when disable_persistence is true', () => {
            new PostHog()._init('test-token', { disable_persistence: true, cookieless_mode: 'always' })
            expect(warnSpy).not.toHaveBeenCalledWith('[PostHog.js]', expect.stringContaining('bootstrap.distinctID'))
        })

        // Empty, whitespace-only, and null distinctIDs are type-legal for JS callers but not a usable stable
        // id (identify() rejects them the same way), so the warning must still fire.
        it.each([
            ['an empty string', ''],
            ['a whitespace-only string', '   '],
            ['null', null as unknown as string],
        ])('warns when persistence is volatile and bootstrap.distinctID is %s', (_label, distinctID) => {
            new PostHog()._init('test-token', { persistence: 'memory', bootstrap: { distinctID } })
            expect(warnSpy).toHaveBeenCalledWith('[PostHog.js]', expect.stringContaining('bootstrap.distinctID'))
        })

        it('does not warn when bootstrap.distinctID is a non-empty string', () => {
            new PostHog()._init('test-token', { persistence: 'memory', bootstrap: { distinctID: 'stable-id' } })
            expect(warnSpy).not.toHaveBeenCalledWith('[PostHog.js]', expect.stringContaining('bootstrap.distinctID'))
        })

        it('does not warn for the default localStorage+cookie persistence', () => {
            new PostHog()._init('test-token')
            expect(warnSpy).not.toHaveBeenCalledWith('[PostHog.js]', expect.stringContaining('bootstrap.distinctID'))
        })

        // Count only the distinct-ID warnings so unrelated console.warn calls (deprecations, etc.) don't skew it.
        const bootstrapWarnings = () =>
            warnSpy.mock.calls.filter((args) => typeof args[1] === 'string' && args[1].includes('bootstrap.distinctID'))

        // _init() calls set_config() internally before persistence exists; that internal call must not
        // re-trigger the warning on top of the init check.
        it('warns exactly once at init for volatile persistence', () => {
            new PostHog()._init('test-token', { persistence: 'memory' })
            expect(bootstrapWarnings()).toHaveLength(1)
        })

        // set_config() can move persistence to a volatile mode after init. The migration drops durable
        // identity, so the next load mints a fresh ID — the same failure the init check warns about, which by
        // then has already run and cannot see the switch.
        it.each(['memory', 'sessionStorage'] as const)(
            "warns once when set_config switches persistence to '%s' after init",
            (persistence) => {
                const posthog = new PostHog()
                posthog._init('test-token', { persistence: 'localStorage+cookie' })
                warnSpy.mockClear()

                posthog.set_config({ persistence })

                expect(bootstrapWarnings()).toHaveLength(1)
            }
        )

        it('does not warn when set_config switches persistence but a bootstrap.distinctID is set', () => {
            const posthog = new PostHog()
            posthog._init('test-token', {
                persistence: 'localStorage+cookie',
                bootstrap: { distinctID: 'stable-id' },
            })
            warnSpy.mockClear()

            posthog.set_config({ persistence: 'memory' })

            expect(bootstrapWarnings()).toHaveLength(0)
        })

        // set_config() can also turn on disable_persistence after init, which removes the durable store the
        // same way a switch to a volatile persistence does. The init check has already run and cannot see the
        // later change, so set_config must re-run it.
        it('warns once when set_config enables disable_persistence after init', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { persistence: 'localStorage+cookie' })
            warnSpy.mockClear()

            posthog.set_config({ disable_persistence: true })

            expect(bootstrapWarnings()).toHaveLength(1)
        })

        it('does not warn when set_config enables disable_persistence but a bootstrap.distinctID is set', () => {
            const posthog = new PostHog()
            posthog._init('test-token', {
                persistence: 'localStorage+cookie',
                bootstrap: { distinctID: 'stable-id' },
            })
            warnSpy.mockClear()

            posthog.set_config({ disable_persistence: true })

            expect(bootstrapWarnings()).toHaveLength(0)
        })

        // Only a persistence or disable_persistence change re-runs the check, so repeatedly calling set_config
        // for other reasons under volatile persistence must not re-warn.
        it('does not re-warn when set_config changes an unrelated option under volatile persistence', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { persistence: 'memory' })
            warnSpy.mockClear()

            posthog.set_config({ debug: false })

            expect(bootstrapWarnings()).toHaveLength(0)
        })
    })

    describe('compatibilityDate', () => {
        it('should set capture_pageview to true when defaults is undefined', () => {
            const posthog = new PostHog()
            posthog._init('test-token')
            expect(posthog.config.capture_pageview).toBe(true)
        })

        it('does not apply date-gated session_recording defaults when defaults is explicitly unset', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { defaults: 'unset' })
            expect(posthog.config.session_recording).toStrictEqual({})
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

        it('keeps the date-gated captureJsonLd default with a partial session_recording config', () => {
            const posthog = new PostHog()
            posthog._init('test-token', {
                defaults: '2026-08-30',
                session_recording: { maskAllInputs: false },
            })
            expect(posthog.config.session_recording.captureJsonLd).toBe(true)
            expect(posthog.config.session_recording.maskAllInputs).toBe(false)
        })

        it('lets the user disable the date-gated captureJsonLd default', () => {
            const posthog = new PostHog()
            posthog._init('test-token', {
                defaults: '2026-08-30',
                session_recording: { captureJsonLd: false },
            })
            expect(posthog.config.session_recording.captureJsonLd).toBe(false)
        })

        it.each([
            ['unset', undefined, 0],
            ['2025-05-24', '2025-05-24' as const, 0],
            ['2025-11-30', '2025-11-30' as const, 0],
            ['2026-01-30', '2026-01-30' as const, 0],
            ['2026-05-30', '2026-05-30' as const, 250],
            ['2026-06-25', '2026-06-25' as const, 250],
            ['2026-08-29', '2026-08-29' as const, 250],
            ['2026-08-30', '2026-08-30' as const, 250],
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
            ['2026-08-29', '2026-08-29' as const, true],
            ['2026-08-30', '2026-08-30' as const, true],
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
            ['2026-08-29', '2026-08-29' as const, true],
            ['2026-08-30', '2026-08-30' as const, true],
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
            ['2026-08-29', '2026-08-29' as const, true],
            ['2026-08-30', '2026-08-30' as const, true],
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
            ['2026-08-29', '2026-08-29' as const, true],
            ['2026-08-30', '2026-08-30' as const, true],
        ])('session_recording.streamNetworkBody with defaults %s', (_label, defaults, expected) => {
            const posthog = new PostHog()
            posthog._init('test-token', defaults ? { defaults } : undefined)
            expect(posthog.config.session_recording.streamNetworkBody).toBe(expected)
        })

        it.each([
            ['unset', undefined, false],
            ['explicit unset', 'unset' as const, false],
            ['2025-05-24', '2025-05-24' as const, false],
            ['2025-11-30', '2025-11-30' as const, false],
            ['2026-01-30', '2026-01-30' as const, false],
            ['2026-05-30', '2026-05-30' as const, false],
            ['2026-06-25', '2026-06-25' as const, false],
            ['2026-08-29', '2026-08-29' as const, true],
            ['2026-08-30', '2026-08-30' as const, true],
        ])('cookieWinsOnConflict with defaults %s', (_label, defaults, expected) => {
            const posthog = new PostHog()
            posthog._init('test-token', defaults ? { defaults } : undefined)
            expect(posthog.config.cookieWinsOnConflict).toBe(expected)
        })

        it.each([
            ['unset', undefined, undefined],
            ['explicit unset', 'unset' as const, undefined],
            ['2026-08-29', '2026-08-29' as const, undefined],
            ['2026-08-30', '2026-08-30' as const, true],
        ])('session_recording.captureJsonLd with defaults %s', (_label, defaults, expected) => {
            const posthog = new PostHog()
            posthog._init('test-token', defaults ? { defaults } : undefined)
            expect(posthog.config.session_recording.captureJsonLd).toBe(expected)
        })

        it('keeps capture_copied_text opt-in with the 2026-08-30 defaults', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { defaults: '2026-08-30' })
            expect(posthog.config.autocapture).toBe(true)
        })

        it('maps the deprecated preview option to cookieWinsOnConflict', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { __preview_cookie_wins_on_conflict: true })
            expect(posthog.config.cookieWinsOnConflict).toBe(true)
        })

        it('prefers cookieWinsOnConflict when both options are provided', () => {
            const posthog = new PostHog()
            posthog._init('test-token', {
                cookieWinsOnConflict: false,
                __preview_cookie_wins_on_conflict: true,
            })
            expect(posthog.config.cookieWinsOnConflict).toBe(false)
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

            expect(posthog.config.strict_script_versioning).toBe('fallback')
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

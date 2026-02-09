import { PostHog } from '../posthog-core'
import type { PostHogConfig } from '../types'
import { isFunction } from '@posthog/core'

describe('config', () => {
    describe('compatibilityDate', () => {
        it('should set Jan 2026 values when defaults is undefined', () => {
            const posthog = new PostHog()
            posthog._init('test-token')
            expect(posthog.config.capture_pageview).toBe('history_change')
            expect(posthog.config.session_recording.strictMinimumDuration).toBe(true)
            expect(posthog.config.rageclick).toStrictEqual({ content_ignorelist: true })
            expect(posthog.config.external_scripts_inject_target).toBe('head')
        })

        it('should set legacy values when defaults is unset', () => {
            const posthog = new PostHog()
            posthog._init('test-token', { defaults: 'unset' })
            expect(posthog.config.capture_pageview).toBe(true)
            expect(posthog.config.session_recording).toStrictEqual({})
            expect(posthog.config.rageclick).toBe(true)
            expect(posthog.config.external_scripts_inject_target).toBe('body')
            expect(posthog.config.internal_or_test_user_hostname).toBeUndefined()
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

        it('should preserve other default config values when setting defaults', () => {
            const posthog1 = new PostHog()
            posthog1._init('test-token')
            const config1 = { ...posthog1.config }

            const posthog2 = new PostHog()
            posthog2._init('test-token', { defaults: 'unset' })
            const config2 = posthog2.config

            // Keys that vary between '2026-01-30' (the default) and 'unset'
            const varyingKeys = [
                'capture_pageview',
                'rageclick',
                'session_recording',
                'external_scripts_inject_target',
                'internal_or_test_user_hostname',
                'defaults',
            ]

            // Check that all other config values remain the same
            const allKeys = new Set([...Object.keys(config1), ...Object.keys(config2)])
            allKeys.forEach((key) => {
                if (!varyingKeys.includes(key)) {
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
})

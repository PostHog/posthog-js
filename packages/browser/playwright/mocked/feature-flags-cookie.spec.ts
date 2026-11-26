import { expect, test, WindowWithPostHog } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

const NAME = 'flag-cookie-compatibility'
const COOKIE = `ph_${NAME}`
const KEYS = ['existing-layout', 'existing-checkout', 'existing-search', 'existing-navigation']

const response = (typed: boolean, variant: string) => ({
    flags: Object.fromEntries(
        KEYS.map((key, index) => [
            key,
            {
                key,
                ...(typed ? { value: variant } : { enabled: true, variant }),
                reason: { code: 'condition_match', condition_index: 0, description: 'Matched condition set 1' },
                metadata: {
                    id: 100 + index,
                    version: 1,
                    description: null,
                    payload: null,
                    has_experiment: false,
                    ...(typed ? { config_version: 1, variant_key: variant } : {}),
                },
            },
        ])
    ),
    errorsWhileComputingFlags: false,
})

for (const fallback of [false, true]) {
    test(`v1 flag updates fit an existing cookie and survive reload${fallback ? ' with localStorage unavailable' : ''}`, async ({
        page,
        context,
    }) => {
        if (fallback) {
            await context.addInitScript(() => {
                Object.defineProperty(window, 'localStorage', {
                    get: () => {
                        throw new DOMException('Storage unavailable', 'SecurityError')
                    },
                })
            })
        }
        const options = {
            waitForFlags: false,
            options: {
                persistence: fallback ? ('localStorage+cookie' as const) : ('cookie' as const),
                persistence_name: NAME,
                cross_subdomain_cookie: false,
                advanced_disable_feature_flags_on_first_load: true,
                capture_pageview: false,
                capture_pageleave: false,
                autocapture: false,
                disable_session_recording: true,
                debug: false,
            },
        }
        await start(options, page, context)
        await page.waitForFunction(() => !!(window as WindowWithPostHog).posthog?.persistence)
        let updated = false
        let receivedTyped = false
        await context.route('**/flags/*', (route) => {
            // Compatibility runs also load older cores, which keep requesting the legacy shape.
            const typed = updated && new URL(route.request().url()).searchParams.get('v') === '4'
            receivedTyped ||= typed
            return route.fulfill({ json: response(typed, updated ? 'different' : 'treatment') })
        })
        await page.evaluate(() => (window as WindowWithPostHog).posthog!.reloadFeatureFlags())
        await expect
            .poll(() =>
                page.evaluate(() =>
                    (window as WindowWithPostHog).posthog!.getFeatureFlag('existing-layout', { send_event: false })
                )
            )
            .toBe('treatment')

        // Leave room for cookie attributes, but less than the redundant v4 fields would consume.
        const beforeBytes = await page.evaluate((cookieName) => {
            const ph = (window as WindowWithPostHog).posthog!
            ph.register({ cookie_padding: '' })
            const bytes = cookieName.length + encodeURIComponent(JSON.stringify(ph.persistence!.props)).length
            if (bytes > 3900) {
                throw new Error(`Fixture already exceeds the cookie budget: ${bytes}`)
            }
            ph.register({ cookie_padding: 'x'.repeat(3900 - bytes) })
            return document.cookie.split('; ').find((entry) => entry.startsWith(cookieName + '='))!.length - 1
        }, COOKIE)
        expect(beforeBytes).toBe(3900)

        updated = true
        await page.evaluate(() => (window as WindowWithPostHog).posthog!.reloadFeatureFlags())
        await expect
            .poll(() =>
                page.evaluate(() =>
                    (window as WindowWithPostHog).posthog!.getFeatureFlag('existing-layout', { send_event: false })
                )
            )
            .toBe('different')
        const saved = await page.evaluate((cookieName) => {
            const ph = (window as WindowWithPostHog).posthog!
            const cookie = document.cookie.split('; ').find((entry) => entry.startsWith(cookieName + '='))!
            return {
                bytes: cookie.length - 1,
                unprojectedBytes: cookieName.length + encodeURIComponent(JSON.stringify(ph.persistence!.props)).length,
                live: ph.get_property('$feature_flag_details'),
                stored: JSON.parse(decodeURIComponent(cookie.slice(cookieName.length + 1))),
            }
        }, COOKIE)
        if (!process.env.COMPAT_VERSION) {
            expect(receivedTyped).toBe(true)
        }
        if (receivedTyped) {
            expect(saved.unprojectedBytes).toBeGreaterThan(4096)
        }
        expect(saved.bytes).toBeLessThanOrEqual(beforeBytes)
        for (const key of KEYS) {
            if (receivedTyped) {
                expect(saved.live[key]).toMatchObject({ value: 'different', metadata: { config_version: 1 } })
            }
            expect(saved.stored.$feature_flag_details[key].variant).toBe('different')
            expect(saved.stored.$feature_flag_details[key]).not.toHaveProperty('value')
        }

        const flagRequests: string[] = []
        page.on('request', (request) => {
            if (request.url().includes('/flags/')) flagRequests.push(request.url())
        })
        await start({ ...options, type: 'reload' }, page, context)
        await page.waitForFunction(() => !!(window as WindowWithPostHog).posthog?.persistence)
        const cached = await page.evaluate((keys) => {
            const ph = (window as WindowWithPostHog).posthog!
            return keys.map((key) => ph.getFeatureFlag(key, { send_event: false }))
        }, KEYS)
        expect(cached).toEqual(KEYS.map(() => 'different'))
        expect(flagRequests).toEqual([])
    })
}

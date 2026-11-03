import { expect, test } from '@playwright/test'
import type { PostHogConfig } from '../../src/types'
import type { PostHog } from '../../src/posthog-core'

declare global {
    interface Window {
        urlProbe: PostHog
    }
}

for (const persistence of ['cookie', 'localStorage+cookie', 'localStorage'] as const) {
    test(`preserves long campaign attribution across reload with ${persistence}`, async ({ page }) => {
        const campaign = 's'.repeat(700)
        await page.goto('/playwright/fixtures/url-sanitization.html?referrer=' + 'r'.repeat(500))
        await page.getByRole('link', { name: 'Continue' }).evaluate((link, campaign) => {
            link.setAttribute('href', '?utm_source=' + campaign + '&gclid=remove')
        }, campaign)
        await page.getByRole('link', { name: 'Continue' }).click()
        await page.waitForURL((url) => url.searchParams.get('gclid') === 'remove')
        await page.waitForFunction(() => !!window.urlProbe)
        const init = () =>
            page.evaluate((mode) => {
                window.urlProbe.init('synthetic-attribution-size', {
                    defaults: '2026-08-30',
                    persistence: mode,
                    persistence_name: 'campaign-size-repro',
                    persistence_save_debounce_ms: 0,
                    split_storage: false,
                    cross_subdomain_cookie: false,
                    capture_pageview: false,
                    autocapture: false,
                    person_profiles: 'always',
                    opt_out_useragent_filter: true,
                    disable_session_recording: true,
                    disable_surveys: true,
                    disable_conversations: true,
                    advanced_disable_flags: true,
                    advanced_disable_toolbar_metrics: true,
                    disable_external_dependency_loading: true,
                    url_sanitization: {
                        sanitize: (url) => {
                            url.searchParams.delete('gclid')
                            return url
                        },
                    },
                    before_send: () => null,
                } satisfies Partial<PostHogConfig>)
                window.urlProbe.capture('probe')
                const cookie = document.cookie
                    .split('; ')
                    .find((cookie) => cookie.startsWith('ph_campaign-size-repro='))
                const cookieProps = cookie ? JSON.parse(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))) : {}
                const localProps = JSON.parse(localStorage.getItem('ph_campaign-size-repro') || '{}')
                return {
                    id: window.urlProbe.get_distinct_id(),
                    session: window.urlProbe.get_session_id(),
                    initial:
                        mode === 'localStorage' ? localProps.$initial_person_info : cookieProps.$initial_person_info,
                    sessionProps:
                        mode === 'cookie' ? cookieProps.$client_session_props : localProps.$client_session_props,
                    attribution: window.urlProbe.sessionPropsManager.getSessionProps(),
                    cookieLength: cookie?.length || 0,
                }
            }, persistence)
        const before = await init()
        expect(before.initial.c).toEqual({ gclid: 'remove' })
        expect(before.sessionProps.props.c).toEqual({ gclid: 'remove' })
        expect(before.initial.u).toContain('utm_source=' + campaign)
        expect(before.initial.u).not.toContain('gclid=')
        expect(before.sessionProps.props.u).toBe(before.initial.u)
        expect(before.attribution.$session_entry_utm_source).toBe(campaign)
        expect(before.attribution.$session_entry_gclid).toBe('remove')
        expect(before.cookieLength).toBeLessThan(4096)
        await page.reload()
        await page.waitForFunction(() => !!window.urlProbe)
        const after = await init()
        expect(after.id).toBe(before.id)
        expect(after.session).toBe(before.session)
        expect(after.initial).toEqual(before.initial)
        expect(after.sessionProps).toEqual(before.sessionProps)
        expect(after.attribution).toEqual(before.attribution)
    })
}

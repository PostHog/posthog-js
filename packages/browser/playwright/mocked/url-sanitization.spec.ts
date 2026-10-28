import { expect, test } from '@playwright/test'
import type { PostHog } from '../../src/posthog-core'
import type { PostHogConfig } from '../../src/types'

declare global {
    interface Window {
        urlProbe: PostHog
    }
}

const source = '/playwright/fixtures/url-sanitization.html?token=synthetic-referrer-token#synthetic-fragment'

for (const persistence of ['localStorage', 'localStorage+cookie', 'cookie', 'sessionStorage'] as const) {
    test(`sanitizes referrers before persistence and preserves reload continuity with ${persistence}`, async ({
        page,
    }) => {
        await page.goto(source)
        await page.getByRole('link', { name: 'Continue' }).click()
        await page.waitForURL('**/url-sanitization.html?token=synthetic-current-token**')
        await page.waitForFunction(() => !!window.urlProbe)
        const init = async () =>
            page.evaluate((mode) => {
                window.urlProbe.init('synthetic-url-policy-probe', {
                    defaults: '2026-08-30',
                    persistence: mode,
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
                    url_sanitization: { path: false, query: false, hash: false },
                    before_send: () => null,
                } satisfies Partial<PostHogConfig>)
                window.urlProbe.capture('probe')
                return {
                    referrer: document.referrer,
                    id: window.urlProbe.get_distinct_id(),
                    session: window.urlProbe.get_session_id(),
                    initial: window.urlProbe.persistence.props.$initial_person_info,
                    sessionProps: window.urlProbe.persistence.props.$client_session_props.props,
                    stored: JSON.stringify({
                        local: { ...localStorage },
                        session: { ...sessionStorage },
                        cookie: decodeURIComponent(document.cookie),
                    }),
                }
            }, persistence)
        const before = await init()
        expect(before.referrer).toContain('/playwright/fixtures/url-sanitization.html?token=synthetic-referrer-token')
        expect(before.referrer).not.toContain('synthetic-fragment')
        expect(before.initial.r).toBe('http://localhost:2345/')
        expect(before.sessionProps).toEqual(before.initial)
        expect(before.stored).not.toContain('synthetic-referrer-token')
        await page.reload()
        await page.waitForFunction(() => !!window.urlProbe)
        const after = await init()
        expect(after.id).toBe(before.id)
        expect(after.session).toBe(before.session)
        expect(after.initial.r).toBe('http://localhost:2345/')
        expect(after.sessionProps.r).toBe('http://localhost:2345/')
        expect(after.stored).not.toContain('synthetic-referrer-token')
    })
}

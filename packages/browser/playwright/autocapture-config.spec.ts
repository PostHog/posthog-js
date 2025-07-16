import { test } from './fixtures'

test.describe('autocapture config', () => {
    test.use({
        url: '/playground/cypress/index.html',
        flagsOverrides: {
            sessionRecording: {
                endpoint: '/ses/',
            },
            capturePerformance: true,
        },
    })

    test('do not capture click if not in allowlist', async ({ page, posthog, events }) => {
        await posthog.init({
            capture_pageview: false,
            autocapture: {
                dom_event_allowlist: ['change'],
            },
        })

        await page.locator('[data-cy-custom-event-button]').click()
        // no autocapture event from click
        events.expectMatchList(['custom-event'])

        await page.locator('[data-cy-input]').fill('hello posthog!')
        // blur the input
        await page.locator('body').click()
        events.expectMatchList(['custom-event', '$autocapture'])
    })

    test('capture clicks when configured to', async ({ page, posthog, events }) => {
        await posthog.init({
            autocapture: { dom_event_allowlist: ['click'] },
        })

        await page.locator('[data-cy-custom-event-button]').click()
        events.expectMatchList(['$pageview', '$autocapture', 'custom-event'])

        await page.locator('[data-cy-input]').fill('hello posthog!')
        // blur the input
        await page.locator('body').click()
        // no change autocapture event
        events.expectMatchList(['$pageview', '$autocapture', 'custom-event'])
    })

    test('obeys url allowlist', async ({ page, posthog, events }) => {
        await posthog.init({ autocapture: { url_allowlist: ['.*test-is-not-on-this.*'] } })

        await page.click('[data-cy-custom-event-button]')
        events.expectMatchList(['$pageview', 'custom-event'])

        await page.reload()
        await posthog.init({ autocapture: { url_allowlist: ['.*cypress.*'] } })
        events.clear()

        await page.click('[data-cy-custom-event-button]')
        events.expectMatchList(['$pageview', '$autocapture', 'custom-event'])
    })

    test('obeys element allowlist', async ({ page, posthog, events }) => {
        await posthog.init({ autocapture: { element_allowlist: ['button'] } })

        await page.click('[data-cy-custom-event-button]')
        events.expectMatchList(['$pageview', '$autocapture', 'custom-event'])

        await page.reload()
        await posthog.init({ autocapture: { element_allowlist: ['input'] } })
        events.clear()

        await page.click('[data-cy-custom-event-button]')
        events.expectMatchList(['$pageview', 'custom-event'])
    })

    test('obeys css selector allowlist', async ({ page, posthog, events }) => {
        await posthog.init({ autocapture: { css_selector_allowlist: ['[data-cy-custom-event-button]'] } })

        await page.locator('[data-cy-custom-event-button]').click()
        events.expectMatchList(['$pageview', '$autocapture', 'custom-event'])

        await page.reload()
        await posthog.init({ autocapture: { css_selector_allowlist: ['[data-cy-input]'] } })
        events.clear()

        await page.locator('[data-cy-custom-event-button]').click()
        events.expectMatchList(['$pageview', 'custom-event'])
    })
})

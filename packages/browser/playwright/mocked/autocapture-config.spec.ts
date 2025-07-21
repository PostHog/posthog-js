import { test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

const startOptions = {
    options: {},
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
    },
    url: '/playground/cypress/index.html',
}

test.describe('autocapture config', () => {
    test('do not capture click if not in allowlist', async ({ page, context }) => {
        await start(
            {
                ...startOptions,
                options: {
                    ...startOptions.options,
                    capture_pageview: false,
                    autocapture: {
                        dom_event_allowlist: ['change'],
                    },
                },
            },
            page,
            context
        )

        await page.locator('[data-cy-custom-event-button]').click()
        // no autocapture event from click
        await page.expectCapturedEventsToBe(['custom-event'])

        await page.locator('[data-cy-input]').fill('hello posthog!')
        // blur the input
        await page.locator('body').click()
        await page.expectCapturedEventsToBe(['custom-event', '$autocapture'])
    })

    test('capture clicks when configured to', async ({ page, context }) => {
        await start(
            {
                ...startOptions,
                options: { ...startOptions.options, autocapture: { dom_event_allowlist: ['click'] } },
            },
            page,
            context
        )

        await page.locator('[data-cy-custom-event-button]').click()
        await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])

        await page.locator('[data-cy-input]').fill('hello posthog!')
        // blur the input
        await page.locator('body').click()
        // no change autocapture event
        await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])
    })

    test('obeys url allowlist', async ({ page, context }) => {
        await start(
            {
                ...startOptions,
                options: { ...startOptions.options, autocapture: { url_allowlist: ['.*test-is-not-on-this.*'] } },
            },
            page,
            context
        )

        await page.locator('[data-cy-custom-event-button]').click()
        await page.expectCapturedEventsToBe(['$pageview', 'custom-event'])

        await page.resetCapturedEvents()
        await start(
            {
                ...startOptions,
                options: { ...startOptions.options, autocapture: { url_allowlist: ['.*cypress.*'] } },
            },
            page,
            context
        )

        await page.locator('[data-cy-custom-event-button]').click()
        await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])
    })

    test('obeys element allowlist', async ({ page, context }) => {
        await start(
            {
                ...startOptions,
                options: { ...startOptions.options, autocapture: { element_allowlist: ['button'] } },
            },
            page,
            context
        )

        await page.locator('[data-cy-custom-event-button]').click()
        await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])

        await page.resetCapturedEvents()
        await start(
            {
                ...startOptions,
                options: { ...startOptions.options, autocapture: { element_allowlist: ['input'] } },
            },
            page,
            context
        )

        await page.locator('[data-cy-custom-event-button]').click()
        await page.expectCapturedEventsToBe(['$pageview', 'custom-event'])
    })

    test('obeys css selector allowlist', async ({ page, context }) => {
        await start(
            {
                ...startOptions,
                options: {
                    ...startOptions.options,
                    autocapture: { css_selector_allowlist: ['[data-cy-custom-event-button]'] },
                },
            },
            page,
            context
        )

        await page.locator('[data-cy-custom-event-button]').click()
        await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])

        await page.resetCapturedEvents()
        await start(
            {
                ...startOptions,
                options: { ...startOptions.options, autocapture: { css_selector_allowlist: ['[data-cy-input]'] } },
            },
            page,
            context
        )

        await page.locator('[data-cy-custom-event-button]').click()
        await page.expectCapturedEventsToBe(['$pageview', 'custom-event'])
    })
})

import { test, WindowWithPostHog } from './utils/posthog-playwright-test-base'
import { start, gotoPage } from './utils/setup'

test.describe('opting out', () => {
    test.describe('when not initialized', () => {
        test('does not capture events without init', async ({ page }) => {
            await gotoPage(page, './playground/cypress/index.html')
            await page.type('[data-cy-input]', 'hello posthog!')
            await page.expectCapturedEventsToBe([])
        })
    })

    test.describe('when starting disabled in some way', () => {
        test('does not capture events when config opts out by default', async ({ page, context }) => {
            await start(
                {
                    flagsResponseOverrides: {
                        autocapture_opt_out: true,
                    },
                    options: {
                        opt_out_capturing_by_default: true,
                    },
                    url: '/playground/cypress/index.html',
                },
                page,
                context
            )

            await page.expectCapturedEventsToBe([])

            await page.type('[data-cy-input]', 'hello posthog!')

            await page.expectCapturedEventsToBe([])
        })

        test('sends a $pageview event when opting in', async ({ page, context }) => {
            await start(
                {
                    flagsResponseOverrides: {
                        autocapture_opt_out: true,
                    },
                    options: {
                        opt_out_capturing_by_default: true,
                    },
                    url: '/playground/cypress/index.html',
                },
                page,
                context
            )

            await page.expectCapturedEventsToBe([])

            await page.evaluate(() => {
                ;(window as WindowWithPostHog).posthog?.opt_in_capturing()
            })

            await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])
        })

        test('does not send a duplicate $pageview event when opting in', async ({ page, context }) => {
            await start(
                {
                    flagsResponseOverrides: {
                        autocapture_opt_out: true,
                    },
                    options: {
                        // start opted in!
                        opt_out_capturing_by_default: false,
                    },
                    url: '/playground/cypress/index.html',
                },
                page,
                context
            )

            await page.expectCapturedEventsToBe(['$pageview'])

            await page.evaluate(() => {
                ;(window as WindowWithPostHog).posthog?.opt_in_capturing()
            })

            await page.expectCapturedEventsToBe(['$pageview', '$opt_in'])
        })
    })

    test.describe('user opts out after start', () => {
        test('does not send any events after that', async ({ page, context }) => {
            await start(
                {
                    flagsResponseOverrides: {
                        autocapture_opt_out: false,
                    },
                    url: '/playground/cypress/index.html',
                },
                page,
                context
            )

            await page.expectCapturedEventsToBe(['$pageview'])

            await page.click('[data-cy-custom-event-button]')

            await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])

            await page.evaluate(() => {
                ;(window as WindowWithPostHog).posthog?.opt_out_capturing()
            })

            await page.click('[data-cy-custom-event-button]')

            // no new events
            await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])
        })
    })
})

import { test } from './fixtures'

test.describe('opting out', () => {
    test.describe('when not initialized', () => {
        test.use({ url: '/playground/cypress/index.html' })
        test('does not capture events without init', async ({ page, events }) => {
            await page.locator('[data-cy-input]').fill('hello posthog!')
            await page.delay(200)
            events.expectMatchList([])
        })
    })

    test.describe('when starting disabled in some way', () => {
        test.use({
            url: '/playground/cypress/index.html',
            posthogOptions: { opt_out_capturing_by_default: true },
            flagsOverrides: { autocapture_opt_out: true },
        })

        test('does not capture events when config opts out by default', async ({ page, posthog, events }) => {
            await posthog.init()
            await page.waitForLoadState('networkidle')
            events.expectMatchList([])
            await page.locator('[data-cy-input]').fill('hello posthog!')
            await page.waitForLoadState('networkidle')
            events.expectMatchList([])
        })

        test('sends a $pageview event when opting in', async ({ posthog, events }) => {
            await posthog.init()
            events.expectMatchList([])
            await posthog.evaluate((ph) => {
                ph.opt_in_capturing()
            })
            await events.waitForEvent('$pageview')
            events.expectMatchList(['$opt_in', '$pageview'])
        })

        test('does not send a duplicate $pageview event when opting in', async ({ posthog, events }) => {
            await posthog.init({
                // start opted in!
                opt_out_capturing_by_default: false,
            })
            await events.waitForEvent('$pageview')
            await posthog.evaluate((ph) => {
                ph.opt_in_capturing()
            })
            await events.waitForEvent('$opt_in')
            events.expectMatchList(['$pageview', '$opt_in'])
        })
    })

    test.describe('user opts out after start', () => {
        test.use({
            url: '/playground/cypress/index.html',
            flagsOverrides: { autocapture_opt_out: false },
        })
        test('does not send any events after that', async ({ page, posthog, events }) => {
            await posthog.init()
            await events.waitForEvent('$pageview')
            await page.click('[data-cy-custom-event-button]')
            events.expectMatchList(['$pageview', '$autocapture', 'custom-event'])
            await posthog.evaluate((ph) => {
                ph.opt_out_capturing()
            })
            await page.click('[data-cy-custom-event-button]')
            await page.close()
            // no new events
            events.expectMatchList(['$pageview', '$autocapture', 'custom-event'])
        })
    })
})

import { BrowserContext, Page } from '@playwright/test'
import { expect, test, WindowWithPostHog } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

const startOptions = {
    waitForFlags: false,
    options: {
        advanced_disable_feature_flags: true,
        persistence: 'localStorage' as const,
    },
    url: '/playground/cypress/index.html',
}

async function startSecondTab(context: BrowserContext): Promise<Page> {
    const tab = await context.newPage()
    await start(startOptions, tab, context)
    return tab
}

test.describe('cross-tab feature flags', () => {
    test.beforeEach(async ({ page, context }) => {
        await start(startOptions, page, context)
    })

    test('synchronizes early access enrollment and preserves it through sibling writes', async ({ page, context }) => {
        const sibling = await startSecondTab(context)

        await page.evaluate(() => {
            ;(window as WindowWithPostHog).posthog?.updateEarlyAccessFeatureEnrollment('early-access-flag', true)
        })

        await expect
            .poll(() =>
                sibling.evaluate(() =>
                    (window as WindowWithPostHog).posthog?.isFeatureEnabled('early-access-flag', {
                        send_event: false,
                    })
                )
            )
            .toBe(true)
        expect(
            await sibling.evaluate(() => {
                const posthog = (window as WindowWithPostHog).posthog
                posthog?.register({ unrelated: 'sibling-value' })
                return posthog?.isFeatureEnabled('early-access-flag', { send_event: false })
            })
        ).toBe(true)
    })
})

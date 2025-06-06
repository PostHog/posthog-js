import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { PostHog } from '../src/posthog-core'

test.describe('group analytics', () => {
    test('includes group information in all event payloads', async ({ page, context }) => {
        await start(
            {
                runBeforePostHogInit: async (page) => {
                    // it's tricky to pass functions as args the way posthog config is passed in playwright
                    // so here we set the function on the window object
                    // and then call it in the loaded function during init
                    await page.evaluate(() => {
                        ;(window as any).__ph_loaded = (ph: PostHog) => {
                            ph.group('company', 'id:5')
                        }
                    })
                },
            },
            page,
            context
        )

        await page.locator('[data-cy-custom-event-button]').click()

        const capturedEvents = await page.capturedEvents()
        expect(capturedEvents).toHaveLength(3)
        const hasGroups = new Set(capturedEvents.map((x) => !!x.properties.$groups))
        expect(hasGroups).toEqual(new Set([true]))
    })
})

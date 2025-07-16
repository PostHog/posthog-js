import { expect, test } from './fixtures'
import { PostHog } from '../src/posthog-core'

test.describe('group analytics', () => {
    test.use({ url: '/playground/cypress/index.html' })

    test('includes group information in all event payloads', async ({ page, posthog, events }) => {
        await page.evaluate(() => {
            ;(window as any).__ph_loaded = (ph: PostHog) => {
                ph.group('company', 'id:5')
            }
        })
        await posthog.init()
        await page.locator('[data-cy-custom-event-button]').click()

        const capturedEvents = events.all()
        expect(capturedEvents).toHaveLength(3)
        const hasGroups = new Set(capturedEvents.map((x) => !!x.properties.$groups))
        expect(hasGroups).toEqual(new Set([true]))
    })
})

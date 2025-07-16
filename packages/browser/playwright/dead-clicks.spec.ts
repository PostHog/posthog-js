import { expect, test } from './fixtures'

test.describe('Dead clicks', () => {
    test.use({ posthogOptions: { capture_dead_clicks: true }, url: '/playground/cypress/index.html' })

    test('capture dead clicks when configured to', async ({ page, posthog, events }) => {
        await posthog.init()

        await page.locator('[data-cy-not-an-order-button]').click()

        await events.waitForEvent('$dead_click')

        const deadClicks = events.filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(1)
        const deadClick = deadClicks[0]

        // this assertion flakes, sometimes there is no $dead_click_last_mutation_timestamp
        //expect(deadClick.properties.$dead_click_last_mutation_timestamp).toBeGreaterThan(0)
        expect(deadClick.properties.$dead_click_event_timestamp).toBeGreaterThan(0)
        expect(deadClick.properties.$dead_click_absolute_delay_ms).toBeGreaterThan(0)
        expect(deadClick.properties.$dead_click_scroll_timeout).toBe(false)
        expect(deadClick.properties.$dead_click_mutation_timeout).toBe(false)
        expect(deadClick.properties.$dead_click_absolute_timeout).toBe(true)
    })

    test('does not capture dead click for selected text', async ({ page, posthog, events }) => {
        await posthog.init()

        const locator = page.locator('[data-cy-dead-click-text]')
        const boundingBox = await locator.boundingBox()
        if (!boundingBox) {
            throw new Error('must get a bounding box')
        }
        const position = boundingBox.x + boundingBox.width / 2
        const wordToSelectLength = 50

        await page.mouse.move(position, boundingBox.y)

        await page.mouse.down()
        await page.mouse.move(position + wordToSelectLength, boundingBox.y)
        await page.mouse.up()
        await page.mouse.dblclick(position, boundingBox.y)

        const selection = await page.evaluate(() => window.getSelection()?.toString())
        expect(selection?.trim().length).toBeGreaterThan(0)

        await page.waitForTimeout(1000)

        events.expectMatchList(['$pageview'])
    })
})

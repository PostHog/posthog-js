import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { pollUntilEventCaptured } from './utils/event-capture-utils'

const startOptions = {
    options: {
        capture_dead_clicks: true,
    },
    url: './playground/cypress/index.html',
}

test.describe('Dead clicks', () => {
    test('capture dead clicks when configured to', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.locator('[data-cy-not-an-order-button]').click()

        await pollUntilEventCaptured(page, '$dead_click')

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(1)
        const deadClick = deadClicks[0]

        expect(deadClick.properties.$dead_click_last_mutation_timestamp).toBeGreaterThan(0)
        expect(deadClick.properties.$dead_click_event_timestamp).toBeGreaterThan(0)
        expect(deadClick.properties.$dead_click_absolute_delay_ms).toBeGreaterThan(0)
        expect(deadClick.properties.$dead_click_scroll_timeout).toBe(false)
        expect(deadClick.properties.$dead_click_mutation_timeout).toBe(false)
        expect(deadClick.properties.$dead_click_absolute_timeout).toBe(true)
    })

    test('does not capture dead click for selected text', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.resetCapturedEvents()

        const locator = await page.locator('[data-cy-dead-click-text]')

        await locator.evaluate((el) => {
            const selection = window.getSelection()!
            const content = el.textContent!
            const wordToSelect = content.split(' ')[1]
            const range = document.createRange()
            range.setStart(el.childNodes[0], content.indexOf(wordToSelect))
            range.setEnd(el.childNodes[0], content.indexOf(wordToSelect) + wordToSelect.length)
            // really i want to do this with the mouse maybe
            selection.removeAllRanges()
            selection.addRange(range)
        })

        await page.waitForTimeout(1000)
        await page.expectCapturedEventsToBe([])
    })
})

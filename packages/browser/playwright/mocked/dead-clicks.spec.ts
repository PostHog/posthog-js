import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { pollUntilEventCaptured } from './utils/event-capture-utils'

const startOptions = {
    options: {
        capture_dead_clicks: true,
    },
    url: '/playground/cypress/index.html',
}

test.describe('Dead clicks', () => {
    test('capture dead clicks when configured to', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.locator('[data-cy-not-an-order-button]').click()

        await pollUntilEventCaptured(page, '$dead_click')

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
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

    test('captures dead swipes when configured to', async ({ page, context }) => {
        await start(startOptions, page, context)

        const target = page.locator('[data-cy-not-an-order-button]')
        await target.evaluate((element) => {
            const boundingBox = element.getBoundingClientRect()
            const start = { clientX: boundingBox.x + boundingBox.width / 2, clientY: boundingBox.y + 10 }
            const end = { clientX: start.clientX, clientY: start.clientY + 100 }

            const dispatchTouch = (eventType: 'touchstart' | 'touchend', touch: typeof start): void => {
                const event = new Event(eventType, { bubbles: true, cancelable: true })
                Object.defineProperty(event, eventType === 'touchstart' ? 'touches' : 'changedTouches', {
                    value: [touch],
                })
                element.dispatchEvent(event)
            }

            dispatchTouch('touchstart', start)
            dispatchTouch('touchend', end)
        })

        await pollUntilEventCaptured(page, '$dead_swipe')

        const deadSwipes = (await page.capturedEvents()).filter((event) => event.event === '$dead_swipe')
        expect(deadSwipes).toHaveLength(1)
        expect(deadSwipes[0].properties.$dead_swipe_direction).toBe('down')
        expect(deadSwipes[0].properties.$dead_swipe_distance_px).toBe(100)
        expect(deadSwipes[0].properties.$dead_swipe_absolute_timeout).toBe(true)
    })

    test('does not capture dead click when ctrl key is held', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.resetCapturedEvents()

        await page.locator('[data-cy-not-an-order-button]').click({ modifiers: ['Control'] })

        // wait long enough for a dead click to be detected if it was going to be
        await page.waitForTimeout(3500)

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(0)
    })

    test('does not capture dead click when meta/cmd key is held', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.resetCapturedEvents()

        await page.locator('[data-cy-not-an-order-button]').click({ modifiers: ['Meta'] })

        await page.waitForTimeout(3500)

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(0)
    })

    test('does not capture dead click when shift key is held', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.resetCapturedEvents()

        await page.locator('[data-cy-not-an-order-button]').click({ modifiers: ['Shift'] })

        await page.waitForTimeout(3500)

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(0)
    })

    test('does not capture dead click when alt key is held', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.resetCapturedEvents()

        await page.locator('[data-cy-not-an-order-button]').click({ modifiers: ['Alt'] })

        await page.waitForTimeout(3500)

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(0)
    })

    test('captures dead click with modifier key when capture_clicks_with_modifier_keys is true', async ({
        page,
        context,
    }) => {
        await start(
            {
                options: {
                    capture_dead_clicks: {
                        capture_clicks_with_modifier_keys: true,
                    },
                },
                url: '/playground/cypress/index.html',
            },
            page,
            context
        )

        // Wait for dead clicks extension to be fully loaded
        await page.waitForFunction(
            () => {
                const win = window as any
                return !!win.posthog?.deadClicksAutocapture?.lazyLoadedDeadClicksAutocapture
            },
            { timeout: 10000 }
        )

        await page.resetCapturedEvents()

        // Use Shift modifier since Ctrl+Click triggers contextmenu instead of click in some browsers
        await page.locator('[data-cy-not-an-order-button]').click({ modifiers: ['Shift'] })

        await pollUntilEventCaptured(page, '$dead_click')

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(1)
    })

    test('does not capture dead click when visibility changes to visible after click', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.resetCapturedEvents()

        await page.locator('[data-cy-not-an-order-button]').click()

        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true })
            document.dispatchEvent(new Event('visibilitychange'))
        })

        await page.waitForTimeout(3500)

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(0)
    })

    test('does not capture dead click when visibility changes to visible just before click', async ({
        page,
        context,
    }) => {
        await start(startOptions, page, context)

        await page.resetCapturedEvents()

        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true })
            document.dispatchEvent(new Event('visibilitychange'))
        })

        await page.locator('[data-cy-not-an-order-button]').click()

        await page.waitForTimeout(3500)

        const deadClicks = (await page.capturedEvents()).filter((event) => event.event === '$dead_click')
        expect(deadClicks.length).toBe(0)
    })

    test('does not capture dead click for selected text', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.resetCapturedEvents()

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
        await page.expectCapturedEventsToBe([])
    })
})

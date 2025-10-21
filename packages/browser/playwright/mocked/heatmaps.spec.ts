import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { pollUntilEventCaptured } from './utils/event-capture-utils'

const startOptions = {
    options: {
        capture_heatmaps: {
            flush_interval_milliseconds: 1000, // Short interval for testing
        },
    },
    url: '/playground/cypress/index.html',
}

test.describe('Heatmaps', () => {
    test('captures click and mousemove events', async ({ page, context }) => {
        await start(startOptions, page, context)

        // Reset to clear any initial events
        await page.resetCapturedEvents()

        // Perform a click
        await page.locator('[data-cy-custom-event-button]').click()

        // Perform a mousemove
        await page.mouse.move(100, 100)

        // Wait for the heatmap event to be flushed
        await pollUntilEventCaptured(page, '$$heatmap')

        const heatmapEvents = (await page.capturedEvents()).filter((event) => event.event === '$$heatmap')
        expect(heatmapEvents.length).toBeGreaterThanOrEqual(1)

        const heatmapEvent = heatmapEvents[0]
        expect(heatmapEvent.properties.$heatmap_data).toBeDefined()

        // $heatmap_data is an object keyed by URL
        const heatmapData = heatmapEvent.properties.$heatmap_data
        expect(typeof heatmapData).toBe('object')

        // Get the events for the current URL
        const urls = Object.keys(heatmapData)
        expect(urls.length).toBeGreaterThan(0)

        const eventData = heatmapData[urls[0]]
        expect(Array.isArray(eventData)).toBe(true)
        expect(eventData.length).toBeGreaterThan(0)

        // Verify event structure
        const firstEvent = eventData[0]
        expect(firstEvent).toHaveProperty('x')
        expect(firstEvent).toHaveProperty('y')
        expect(firstEvent).toHaveProperty('target_fixed')
        expect(firstEvent).toHaveProperty('type')
        expect(typeof firstEvent.x).toBe('number')
        expect(typeof firstEvent.y).toBe('number')
        expect(typeof firstEvent.target_fixed).toBe('boolean')
        expect(['click', 'mousemove', 'rageclick', 'deadclick']).toContain(firstEvent.type)
    })

    test('captures rageclick events', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.resetCapturedEvents()

        // Perform multiple rapid clicks in the same location to trigger a rageclick
        const locator = page.locator('[data-cy-custom-event-button]')
        const boundingBox = await locator.boundingBox()
        if (!boundingBox) {
            throw new Error('must get a bounding box')
        }

        const x = boundingBox.x + boundingBox.width / 2
        const y = boundingBox.y + boundingBox.height / 2

        // Click 5 times rapidly in the same spot
        for (let i = 0; i < 5; i++) {
            await page.mouse.click(x, y)
            await page.waitForTimeout(50) // Small delay between clicks
        }

        // Wait for the heatmap event to be flushed
        await pollUntilEventCaptured(page, '$$heatmap')

        const heatmapEvents = (await page.capturedEvents()).filter((event) => event.event === '$$heatmap')
        expect(heatmapEvents.length).toBeGreaterThanOrEqual(1)

        const heatmapEvent = heatmapEvents[0]
        const heatmapData = heatmapEvent.properties.$heatmap_data
        const urls = Object.keys(heatmapData)
        const eventData = heatmapData[urls[0]]

        // Check if we captured a rageclick
        const rageclickEvents = eventData.filter((e: any) => e.type === 'rageclick')
        expect(rageclickEvents.length).toBeGreaterThan(0)
    })

    test('does not capture events when heatmaps are disabled', async ({ page, context }) => {
        await start(
            {
                options: {
                    capture_heatmaps: false,
                },
                url: '/playground/cypress/index.html',
            },
            page,
            context
        )

        await page.resetCapturedEvents()

        // Perform a click
        await page.locator('[data-cy-custom-event-button]').click()

        // Perform a mousemove
        await page.mouse.move(100, 100)

        // Wait a bit
        await page.waitForTimeout(2000)

        // Should not have captured any heatmap events
        const heatmapEvents = (await page.capturedEvents()).filter((event) => event.event === '$$heatmap')
        expect(heatmapEvents.length).toBe(0)
    })
})

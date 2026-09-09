import { expect, test } from './utils/posthog-playwright-test-base'
import { Request } from '@playwright/test'
import { start } from './utils/setup'
import { pollUntilCondition } from './utils/event-capture-utils'

const refreshIntervalMs = 300

test.describe('automatic feature flag refresh', () => {
    let flagsRequests: Request[] = []

    test.beforeEach(async ({ page, context }) => {
        flagsRequests = []

        page.on('request', (request) => {
            if (request.url().includes('/flags/')) {
                flagsRequests.push(request)
            }
        })

        await start(
            {
                options: { remote_config_refresh_interval_ms: refreshIntervalMs },
                url: '/playground/cypress/index.html',
            },
            page,
            context
        )
        await pollUntilCondition(page, () => flagsRequests.length >= 1)
    })

    test('backs off while nobody interacts with the page', async ({ page }) => {
        // The interval doubles after every refresh, so ten intervals hold at most
        // four refreshes: at one, three, seven, and fifteen intervals.
        await page.waitForTimeout(refreshIntervalMs * 10)

        expect(flagsRequests.length).toBeGreaterThan(1)
        expect(flagsRequests.length).toBeLessThanOrEqual(5)
    })

    test('returns to the configured interval after a click', async ({ page }) => {
        await page.waitForTimeout(refreshIntervalMs * 10)
        const idleRequestCount = flagsRequests.length

        await page.mouse.click(0, 0)
        await page.waitForTimeout(refreshIntervalMs * 3)

        expect(flagsRequests.length).toBeGreaterThanOrEqual(idleRequestCount + 2)
    })
})

import { expect, test } from './utils/posthog-playwright-test-base'
import { Page, Request } from '@playwright/test'
import { start } from './utils/setup'

const refreshIntervalMs = 5 * 60_000

async function advanceTime(page: Page, milliseconds: number, expectsRefresh = true): Promise<void> {
    const response = expectsRefresh ? page.waitForResponse((response) => response.url().includes('/flags/')) : undefined
    await page.clock.fastForward(milliseconds)
    await page.clock.runFor(10)
    if (response) {
        await (await response).finished()
    }
}

test.describe('automatic feature flag refresh', () => {
    let flagsRequests: Request[] = []

    test.beforeEach(async ({ page, context }) => {
        flagsRequests = []
        await page.clock.install()

        page.on('request', (request) => {
            if (request.url().includes('/flags/')) {
                flagsRequests.push(request)
            }
        })

        const initialResponse = page.waitForResponse((response) => response.url().includes('/flags/'))
        await start(
            {
                url: '/playground/cypress/index.html',
            },
            page,
            context
        )
        await (await initialResponse).finished()
        expect(flagsRequests.length).toBe(1)
    })

    test('backs off while nobody interacts with the page and continues refreshing hourly', async ({ page }) => {
        await advanceTime(page, refreshIntervalMs)
        expect(flagsRequests.length).toBe(2)
        await advanceTime(page, refreshIntervalMs, false)
        expect(flagsRequests.length).toBe(2)
        await advanceTime(page, refreshIntervalMs)
        expect(flagsRequests.length).toBe(3)
        await advanceTime(page, refreshIntervalMs * 4)
        expect(flagsRequests.length).toBe(4)
        await advanceTime(page, refreshIntervalMs * 8)
        expect(flagsRequests.length).toBe(5)
        await advanceTime(page, 60 * 60_000)
        expect(flagsRequests.length).toBe(6)
        await advanceTime(page, 60 * 60_000)
        expect(flagsRequests.length).toBe(7)
    })

    test('returns to the default interval after a click', async ({ page }) => {
        await advanceTime(page, refreshIntervalMs)
        await advanceTime(page, refreshIntervalMs * 2)
        await advanceTime(page, refreshIntervalMs * 4)
        const idleRequestCount = flagsRequests.length

        await page.mouse.click(0, 0)
        await advanceTime(page, refreshIntervalMs)
        await advanceTime(page, refreshIntervalMs)

        expect(flagsRequests.length).toBe(idleRequestCount + 2)
    })

    test('keeps an explicit interval fixed without user interaction', async ({ page }) => {
        await page.evaluate(() => {
            window.posthog?.set_config({ remote_config_refresh_interval_ms: 60_000 })
        })
        const initialRequestCount = flagsRequests.length

        for (let i = 0; i < 10; i++) {
            await advanceTime(page, 60_000)
        }

        expect(flagsRequests.length).toBe(initialRequestCount + 10)
    })
})

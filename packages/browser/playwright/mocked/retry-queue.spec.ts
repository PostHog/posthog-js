import { Page, BrowserContext } from '@playwright/test'
import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

async function retryHarness(page: Page, context: BrowserContext, successesAfter: number) {
    const attempts: number[] = []
    let enqueued = 0
    let initialRetryParameter: boolean | undefined
    page.on('console', (message) => {
        if (message.text().includes('Enqueued failed request for retry')) enqueued++
    })
    await page.clock.install({ time: new Date('2024-01-01T00:00:00Z') })
    await page.addInitScript(() => {
        Math.random = () => 0.5
    })
    await context.route('**/e/**', async (route) => {
        const parameters = new URL(route.request().url()).searchParams
        if (attempts.length === 0) initialRetryParameter = parameters.has('retry_count')
        attempts.push(Number(parameters.get('retry_count') || 0))
        await route.fulfill({
            status: attempts.length > successesAfter ? 200 : 500,
            contentType: 'application/json',
            body: '{}',
        })
    })
    await start(
        { options: { capture_pageview: false, debug: true }, url: '/playground/cypress/index.html' },
        page,
        context
    )
    await page.clock.pauseAt(new Date('2024-01-01T00:01:00Z'))
    await page.evaluate(() =>
        window.posthog.capture('retry-control', { marker: 'preserve-me' }, { send_instantly: true })
    )
    await expect.poll(() => enqueued).toBe(1)
    expect(initialRetryParameter).toBe(false)
    return { attempts, enqueued: () => enqueued }
}

async function advanceRetry(page: Page) {
    const response = page.waitForResponse('**/e/**')
    await page.clock.fastForward(45 * 60 * 1000)
    await (await response).finished()
    // Network callbacks cross the browser/runner boundary independently of the paused clock.
    await page.waitForTimeout(100)
}

async function advanceBeyondRetryHorizon(page: Page) {
    await page.clock.fastForward(45 * 60 * 1000 + 3001)
    await page.clock.runFor(3001)
    await page.waitForTimeout(100)
}

test.describe('retry queue', () => {
    test('retries failed capture requests and stops after success', async ({ page, context }) => {
        const state = await retryHarness(page, context, 3)
        for (let retry = 1; retry <= 3; retry++) {
            await advanceRetry(page)
            await expect.poll(() => state.attempts.length).toBe(retry + 1)
            if (retry < 3) await expect.poll(state.enqueued).toBe(retry + 1)
        }
        expect(state.attempts).toEqual([0, 1, 2, 3])
        await advanceBeyondRetryHorizon(page)
        expect(state.attempts).toEqual([0, 1, 2, 3])
    })

    test('stops retrying after 10 retries plus the initial attempt', async ({ page, context }) => {
        const state = await retryHarness(page, context, Infinity)
        for (let retry = 1; retry <= 10; retry++) {
            await advanceRetry(page)
            await expect.poll(() => state.attempts.length).toBe(retry + 1)
            if (retry < 10) await expect.poll(state.enqueued).toBe(retry + 1)
        }
        expect(state.attempts).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        await advanceBeyondRetryHorizon(page)
        expect(state.attempts).toHaveLength(11)
    })

    test('immediately retries overdue work when coming back online', async ({ page, context }) => {
        const state = await retryHarness(page, context, 1)
        await context.setOffline(true)
        await page.evaluate(() => window.dispatchEvent(new Event('offline')))
        await page.clock.runFor(3001)
        expect(state.attempts).toEqual([0])
        const response = page.waitForResponse('**/e/**')
        await context.setOffline(false)
        await page.evaluate(() => window.dispatchEvent(new Event('online')))
        await (await response).finished()
        // The paused clock excludes an ordinary polling tick as the cause of this request.
        expect(state.attempts).toEqual([0, 1])
    })
})

import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { Request } from '@playwright/test'

const startOptions = {
    options: {},
    url: '/playground/cypress/index.html',
}

test.describe('retry queue', () => {
    test('retries failed capture requests and stops after success', async ({ page, context }) => {
        test.setTimeout(90000)
        const captureRequests: Request[] = []
        let errorResponseCount = 0
        const maxErrorResponses = 3
        let successSeen = false

        // Mock the capture endpoint to fail initially, then succeed
        await context.route(/\/batch\//, async (route) => {
            const request = route.request()
            captureRequests.push(request)

            if (errorResponseCount < maxErrorResponses) {
                errorResponseCount++
                await route.fulfill({
                    status: 500,
                    contentType: 'text/plain',
                    body: 'Internal Server Error',
                })
            } else {
                successSeen = true
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ status: 'ok' }),
                })
            }
        })

        // Initialize PostHog without pageview to avoid extra requests
        await start({ ...startOptions, options: { capture_pageview: false } }, page, context)

        // Capture a custom event which will initially fail
        await page.evaluate(() => {
            window.posthog.capture('test-retry-event', { test: 'data' })
        })

        // Wait until we see the successful response (4th request)
        await expect(async () => {
            expect(successSeen).toBe(true)
        }).toPass({ timeout: 50000 })

        // Check that we retried the failed requests before succeeding
        expect(captureRequests.length).toBeGreaterThanOrEqual(maxErrorResponses + 1)

        // After success, record the count and verify no more requests arrive
        const requestCountAfterSuccess = captureRequests.length
        await expect(async () => {
            expect(captureRequests.length).toBe(requestCountAfterSuccess)
        }).toPass({ timeout: 5000 })
    })

    test('retries failed capture requests without unbounded attempts', async ({ page, context }) => {
        test.setTimeout(60000)
        const captureRequests: Request[] = []

        // Mock the capture endpoint to always fail
        await context.route(/\/batch\//, async (route) => {
            captureRequests.push(route.request())
            await route.fulfill({
                status: 500,
                contentType: 'text/plain',
                body: 'Internal Server Error',
            })
        })

        // Initialize PostHog without pageview
        await start({ ...startOptions, options: { capture_pageview: false } }, page, context)

        // Capture a custom event which will fail
        await page.evaluate(() => {
            window.posthog.capture('test-max-retries-event', { test: 'data' })
        })

        // Wait for several retries
        // The backoff increases exponentially: 3s, 6s, 12s, 24s, etc.
        // We'll wait long enough to see at least 3-4 retries
        await page.waitForTimeout(25000)

        // Should have some retries but not exceed the initial attempt + 10 retries
        expect(captureRequests.length).toBeGreaterThan(1)
        expect(captureRequests.length).toBeLessThanOrEqual(11)
    })

    test('immediately retries when coming back online', async ({ page, context }) => {
        const captureRequests: Request[] = []

        // Mock the capture endpoint to fail initially
        let shouldSucceed = false
        await context.route(/\/batch\//, async (route) => {
            captureRequests.push(route.request())
            if (shouldSucceed) {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ status: 'ok' }),
                })
            } else {
                await route.fulfill({
                    status: 500,
                    contentType: 'text/plain',
                    body: 'Internal Server Error',
                })
            }
        })

        // Initialize PostHog without pageview
        await start({ ...startOptions, options: { capture_pageview: false } }, page, context)

        // Capture an event that will fail
        await page.evaluate(() => {
            window.posthog.capture('test-offline-event', { test: 'data' })
        })

        // Wait for at least the initial request to be made
        await expect(async () => {
            expect(captureRequests.length).toBeGreaterThanOrEqual(1)
        }).toPass({ timeout: 10000 })

        // Simulate going offline
        await context.setOffline(true)

        // Record the count before going online
        const requestsWhileOffline = captureRequests.length

        // Switch to success mode and come back online
        shouldSucceed = true
        await context.setOffline(false)

        // Trigger the online event
        await page.evaluate(() => {
            window.dispatchEvent(new Event('online'))
        })

        // Wait until we see at least one more request after coming online
        await expect(async () => {
            expect(captureRequests.length).toBeGreaterThan(requestsWhileOffline)
        }).toPass({ timeout: 10000 })
    })
})

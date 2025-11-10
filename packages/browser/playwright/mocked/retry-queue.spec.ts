import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { Request } from '@playwright/test'

const startOptions = {
    options: {},
    url: '/playground/cypress/index.html',
}

test.describe('retry queue', () => {
    test('retries failed capture requests and stops after success', async ({ page, context }) => {
        const captureRequests: Request[] = []
        let errorResponseCount = 0
        const maxErrorResponses = 3

        // Mock the capture endpoint to fail initially, then succeed
        await context.route('**/e/**', async (route) => {
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

        // Wait for the initial request and the retries
        // The retry queue polls every 3 seconds with exponential backoff
        // First retry: ~3-9 seconds
        // Second retry: ~6-18 seconds
        // Third retry: ~12-36 seconds
        await page.waitForTimeout(20000)

        // After this wait, we should have:
        // 1. Initial request (failed with 500)
        // 2. First retry with retry_count=1 (failed with 500)
        // 3. Second retry with retry_count=2 (failed with 500)
        // 4. Third retry with retry_count=3 (succeeded with 200)

        // Check that we got multiple requests
        expect(captureRequests.length).toBeGreaterThanOrEqual(3)

        // Verify the first request had no retry_count
        const firstRequest = captureRequests[0]
        expect(firstRequest.url()).not.toContain('retry_count')

        // Verify retry_count increments
        const retryCountMatches = captureRequests
            .map((req) => {
                const match = req.url().match(/retry_count=(\d+)/)
                return match ? parseInt(match[1]) : null
            })
            .filter((count) => count !== null)

        // Should see incrementing retry counts
        expect(retryCountMatches.length).toBeGreaterThanOrEqual(2)
        expect(retryCountMatches).toContain(1)
        expect(retryCountMatches).toContain(2)
        // Verify counts are actually incrementing (not stuck at 1)
        const uniqueCounts = Array.from(new Set(retryCountMatches))
        expect(uniqueCounts.length).toBeGreaterThan(1)

        // Wait additional time to ensure no more requests are made after success
        const requestCountAfterSuccess = captureRequests.length
        await page.waitForTimeout(5000)

        // Assert no additional requests were made after success
        expect(captureRequests.length).toBe(requestCountAfterSuccess)
    })

    test('stops retrying after 10 attempts', async ({ page, context }) => {
        const captureRequests: Request[] = []

        // Mock the capture endpoint to always fail
        await context.route('**/e/**', async (route) => {
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

        // Extract all retry counts
        const retryCountMatches = captureRequests
            .map((req) => {
                const match = req.url().match(/retry_count=(\d+)/)
                return match ? parseInt(match[1]) : null
            })
            .filter((count) => count !== null)
            .sort((a, b) => a! - b!)

        // Should have some retries but not exceed 10
        expect(retryCountMatches.length).toBeGreaterThan(0)
        const maxRetryCount = Math.max(...(retryCountMatches as number[]))
        expect(maxRetryCount).toBeLessThanOrEqual(10)

        // Verify counts are incrementing
        expect(retryCountMatches).toContain(1)
        expect(retryCountMatches).toContain(2)
    }, 60000)

    test('immediately retries when coming back online', async ({ page, context }) => {
        const captureRequests: Request[] = []

        // Mock the capture endpoint to fail initially
        let shouldSucceed = false
        await context.route('**/e/**', async (route) => {
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

        // Wait for initial request to be queued and sent
        await page.waitForTimeout(3000)

        // Simulate going offline
        await context.setOffline(true)

        // Wait a bit while offline (less than retry interval)
        await page.waitForTimeout(3000)

        // Should not have made many more requests while offline
        const requestsWhileOffline = captureRequests.length

        // Switch to success mode and come back online
        shouldSucceed = true
        await context.setOffline(false)

        // Trigger the online event
        await page.evaluate(() => {
            window.dispatchEvent(new Event('online'))
        })

        // Wait for the retry to happen after coming online
        await page.waitForTimeout(3000)

        // Should have made at least one more request after coming online
        expect(captureRequests.length).toBeGreaterThan(requestsWhileOffline)
    })
})

import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { Request } from '@playwright/test'

const startOptions = {
    options: {
        __add_tracing_headers: ['example.com', 'no-session.com', 'xhr-test.com'],
    },
    url: '/playground/cypress/index.html',
}

test.describe('tracing headers', () => {
    test('adds PostHog tracing headers to fetch requests', async ({ page, context }) => {
        const fetchRequests: Request[] = []

        page.on('request', (request) => {
            if (request.method() === 'GET' && request.url().includes('example.com')) {
                fetchRequests.push(request)
            }
        })

        await context.route('**/example.com/**', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'text/plain',
                body: 'test response',
            })
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/tracing-headers.js*'],
            action: async () => {
                await start(startOptions, page, context)
            },
        })

        // Trigger a fetch request
        await page.evaluate(() => {
            fetch('https://example.com/api/test')
        })

        // Wait for the request
        await page.waitForTimeout(500)

        expect(fetchRequests.length).toBeGreaterThanOrEqual(1)
        const request = fetchRequests[0]
        const headers = request.headers()

        expect(headers).toMatchObject({
            'x-posthog-distinct-id': expect.any(String),
            'x-posthog-session-id': expect.any(String),
            'x-posthog-window-id': expect.any(String),
        })
    })

    // XHR test fails... needs more testing
    test.skip('adds PostHog tracing headers to XMLHttpRequest', async ({ page, context }) => {
        const xhrRequests: Request[] = []

        page.on('request', (request) => {
            if (request.method() === 'GET' && request.url().includes('xhr-test.com')) {
                xhrRequests.push(request)
            }
        })

        await context.route('**/xhr-test.com/**', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'text/plain',
                body: 'xhr response',
            })
        })

        await start(startOptions, page, context)

        // Trigger an XMLHttpRequest
        await page.evaluate(() => {
            const xhr = new XMLHttpRequest()
            xhr.open('GET', 'https://xhr-test.com/api/test')
            xhr.send()
        })

        // Wait for tracing headers to be loaded and active
        await page.waitForFunction(() => {
            const win = window as any
            return win.__PosthogExtensions__?.tracingHeadersPatchFns && win.posthog
        })

        // Wait for the request
        await page.waitForTimeout(500)

        expect(xhrRequests.length).toEqual(1)
        const request = xhrRequests[0]
        const headers = request.headers()

        expect(headers['x-posthog-distinct-id']).toBeTruthy()
        expect(headers['x-posthog-session-id']).toBeTruthy()
        expect(headers['x-posthog-window-id']).toBeTruthy()
    })

    test('works without session manager', async ({ page, context }) => {
        const fetchRequests: Request[] = []

        page.on('request', (request) => {
            if (request.method() === 'GET' && request.url().includes('no-session.com')) {
                fetchRequests.push(request)
            }
        })

        await context.route('**/no-session.com/**', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'text/plain',
                body: 'test response',
            })
        })

        await start(
            {
                ...startOptions,
                options: {
                    ...startOptions.options,
                    disable_session_recording: true,
                },
            },
            page,
            context
        )

        // Wait for tracing headers to be loaded and active BEFORE triggering fetch
        await page.waitForFunction(() => {
            const win = window as any
            return win.__PosthogExtensions__?.tracingHeadersPatchFns && win.posthog
        })

        // Now trigger a fetch request (after tracing headers are active)
        await page.evaluate(() => {
            fetch('https://no-session.com/api/test')
        })

        // Wait for the request to complete
        await page.waitForTimeout(500)

        expect(fetchRequests.length).toBeGreaterThanOrEqual(1)
        const request = fetchRequests[0]
        const headers = request.headers()

        expect(headers).toMatchObject({
            'x-posthog-distinct-id': expect.any(String),
        })
    })

    test('does NOT add tracing headers to unlisted domains', async ({ page, context }) => {
        const unlistedDomainRequests: Request[] = []

        page.on('request', (request) => {
            if (request.method() === 'GET' && request.url().includes('unlisted.com')) {
                unlistedDomainRequests.push(request)
            }
        })

        await context.route('**/unlisted.com/**', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'text/plain',
                body: 'test response from unlisted domain',
            })
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/tracing-headers.js*'],
            action: async () => {
                await start(startOptions, page, context)
            },
        })

        // Wait for tracing headers to be loaded and active
        await page.waitForFunction(() => {
            const win = window as any
            return win.__PosthogExtensions__?.tracingHeadersPatchFns && win.posthog
        })

        // Trigger a fetch request to an unlisted domain
        await page.evaluate(() => {
            fetch('https://unlisted.com/api/test')
        })

        // Wait for the request
        await page.waitForTimeout(500)

        expect(unlistedDomainRequests.length).toBeGreaterThanOrEqual(1)
        const request = unlistedDomainRequests[0]
        const headers = request.headers()

        // Assert that PostHog tracing headers are NOT present
        expect(headers['x-posthog-distinct-id']).toBeUndefined()
        expect(headers['x-posthog-session-id']).toBeUndefined()
        expect(headers['x-posthog-window-id']).toBeUndefined()
    })

    test('does NOT add tracing headers to unlisted domains via XMLHttpRequest', async ({ page, context }) => {
        const unlistedDomainRequests: Request[] = []

        page.on('request', (request) => {
            if (request.method() === 'POST' && request.url().includes('unlisted-xhr.com')) {
                unlistedDomainRequests.push(request)
            }
        })

        await context.route('**/unlisted-xhr.com/**', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: '{"message": "xhr response from unlisted domain"}',
            })
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/tracing-headers.js*'],
            action: async () => {
                await start(startOptions, page, context)
            },
        })

        // Wait for tracing headers to be loaded and active
        await page.waitForFunction(() => {
            const win = window as any
            return win.__PosthogExtensions__?.tracingHeadersPatchFns && win.posthog
        })

        // Trigger an XMLHttpRequest to an unlisted domain
        await page.evaluate(() => {
            const xhr = new XMLHttpRequest()
            xhr.open('POST', 'https://unlisted-xhr.com/api/test')
            xhr.setRequestHeader('Content-Type', 'application/json')
            xhr.send(JSON.stringify({ test: 'data' }))
        })

        // Wait for the request
        await page.waitForTimeout(500)

        expect(unlistedDomainRequests.length).toBeGreaterThanOrEqual(1)
        const request = unlistedDomainRequests[0]
        const headers = request.headers()

        // Assert that PostHog tracing headers are NOT present
        expect(headers['x-posthog-distinct-id']).toBeUndefined()
        expect(headers['x-posthog-session-id']).toBeUndefined()
        expect(headers['x-posthog-window-id']).toBeUndefined()
    })
})

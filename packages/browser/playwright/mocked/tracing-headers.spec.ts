import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { Page, BrowserContext, Request } from '@playwright/test'

const baseOptions = {
    options: {
        __add_tracing_headers: ['example.com', 'no-session.com', 'xhr-test.com'],
    },
    url: '/playground/cypress/index.html',
}

async function setupAndTriggerRequest(
    page: Page,
    context: BrowserContext,
    config: {
        domain: string
        method?: 'fetch' | 'xhr'
        startOptions?: typeof baseOptions
    }
): Promise<Record<string, string>> {
    const { domain, method = 'fetch', startOptions = baseOptions } = config
    let capturedHeaders: Record<string, string> = {}

    page.on('request', (request: Request) => {
        if (request.url().includes(domain)) {
            capturedHeaders = request.headers()
        }
    })

    await context.route(`**/${domain}/**`, (route) => {
        route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
    })

    await start(startOptions, page, context)

    await page.waitForFunction(() => {
        const win = window as any
        return win.__PosthogExtensions__?.tracingHeadersPatchFns && win.posthog
    })

    if (method === 'fetch') {
        await page.evaluate((d) => fetch(`https://${d}/api/test`), domain)
    } else {
        await page.evaluate((d) => {
            const xhr = new XMLHttpRequest()
            xhr.open('GET', `https://${d}/api/test`)
            xhr.send()
        }, domain)
    }

    await page.waitForTimeout(500)
    return capturedHeaders
}

test.describe('tracing headers', () => {
    const casesWithHeaders = [
        { name: 'fetch to listed domain', domain: 'example.com' },
        { name: 'fetch without session manager', domain: 'no-session.com', disableSession: true },
    ]

    for (const { name, domain, disableSession } of casesWithHeaders) {
        test(`adds tracing headers: ${name}`, async ({ page, context }) => {
            const startOptions = disableSession
                ? { ...baseOptions, options: { ...baseOptions.options, disable_session_recording: true } }
                : baseOptions

            const headers = await setupAndTriggerRequest(page, context, { domain, startOptions })

            expect(headers['x-posthog-distinct-id']).toBeTruthy()
            if (!disableSession) {
                expect(headers['x-posthog-session-id']).toBeTruthy()
                expect(headers['x-posthog-window-id']).toBeTruthy()
            }
        })
    }

    const casesWithoutHeaders = [
        { name: 'fetch to unlisted domain', domain: 'unlisted.com', method: 'fetch' as const },
        { name: 'XHR to unlisted domain', domain: 'unlisted-xhr.com', method: 'xhr' as const },
    ]

    for (const { name, domain, method } of casesWithoutHeaders) {
        test(`does NOT add tracing headers: ${name}`, async ({ page, context }) => {
            const headers = await setupAndTriggerRequest(page, context, { domain, method })

            expect(headers['x-posthog-distinct-id']).toBeUndefined()
            expect(headers['x-posthog-session-id']).toBeUndefined()
            expect(headers['x-posthog-window-id']).toBeUndefined()
        })
    }

    test('preserves FormData request body when passing through fetch wrapper', async ({ page, context, browserName }) => {
        let requestBody: string | null = null
        let contentType: string | null = null

        await context.route('**/example.com/**', async (route) => {
            const request = route.request()
            requestBody = request.postData()
            contentType = request.headers()['content-type']
            await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
        })

        await start(baseOptions, page, context)

        await page.waitForFunction(() => {
            const win = window as any
            return win.__PosthogExtensions__?.tracingHeadersPatchFns && win.posthog
        })

        await page.evaluate(() => {
            const formData = new FormData()
            formData.append('key', 'value')
            formData.append('file', new Blob(['test content'], { type: 'text/plain' }), 'test.txt')
            return fetch('https://example.com/api/upload', {
                method: 'POST',
                body: formData,
            })
        })

        await page.waitForTimeout(500)

        // Verify Content-Type includes multipart/form-data with boundary
        expect(contentType).toContain('multipart/form-data')
        expect(contentType).toContain('boundary=')

        // Verify the request body contains the FormData content
        expect(requestBody).toContain('key')
        expect(requestBody).toContain('value')
        expect(requestBody).toContain('test.txt')
        // WebKit doesn't serialize Blob content in Playwright's postData()
        if (browserName !== 'webkit') {
            expect(requestBody).toContain('test content')
        }

        // Verify the boundary in Content-Type matches the boundary in the body
        // This is the critical assertion - if boundaries mismatch, FormData is corrupted
        const boundaryMatch = contentType?.match(/boundary=([^\s;]+)/)
        expect(boundaryMatch).toBeTruthy()
        if (boundaryMatch) {
            const boundary = boundaryMatch[1]
            expect(requestBody).toContain(boundary)
        }
    })
})

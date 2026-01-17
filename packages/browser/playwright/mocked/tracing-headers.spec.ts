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
})

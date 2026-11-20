import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { Page, BrowserContext, Request } from '@playwright/test'

const baseOptions = {
    options: {
        tracing_headers: ['example.com', 'no-session.com', 'xhr-test.com'],
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
    let capturedHeaders: Record<string, string> | undefined

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
        const response = await page.evaluate(async (d) => {
            const response = await fetch(`https://${d}/api/test`)
            return { status: response.status, body: await response.text() }
        }, domain)
        expect(response).toEqual({ status: 200, body: 'ok' })
    } else {
        const response = await page.evaluate(
            (d) =>
                new Promise<{ status: number; body: string }>((resolve, reject) => {
                    const xhr = new XMLHttpRequest()
                    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText })
                    xhr.onerror = () => reject(new Error('customer XHR failed'))
                    xhr.open('GET', `https://${d}/api/test`)
                    xhr.send()
                }),
            domain
        )
        expect(response).toEqual({ status: 200, body: 'ok' })
    }

    expect(capturedHeaders).toBeDefined()
    return capturedHeaders!
}

test.describe('tracing headers', () => {
    const casesWithHeaders = [
        { name: 'fetch to listed domain', domain: 'example.com' },
        { name: 'fetch with session recording disabled', domain: 'no-session.com', disableSession: true },
    ]

    for (const { name, domain, disableSession } of casesWithHeaders) {
        test(`adds tracing headers: ${name}`, async ({ page, context }) => {
            const startOptions = disableSession
                ? { ...baseOptions, options: { ...baseOptions.options, disable_session_recording: true } }
                : baseOptions

            const headers = await setupAndTriggerRequest(page, context, { domain, startOptions })

            const ids = await page.evaluate(() => {
                const ph = (window as any).posthog
                return { distinctId: ph.get_distinct_id(), ...ph.sessionManager.checkAndGetSessionAndWindowId(true) }
            })
            expect(ids.distinctId).toBeTruthy()
            expect(ids.sessionId).toBeTruthy()
            expect(ids.windowId).toBeTruthy()
            expect(headers['x-posthog-distinct-id']).toBe(ids.distinctId)
            expect(headers['x-posthog-session-id']).toBe(ids.sessionId)
            expect(headers['x-posthog-window-id']).toBe(ids.windowId)
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

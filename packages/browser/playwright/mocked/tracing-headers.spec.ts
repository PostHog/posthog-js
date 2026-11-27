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

const UNSENDABLE_ID_URL = '/__posthog_tracing_unsendable_id_test'

// Another fetch wrapper installed before PostHog rebuilds whatever Request it is handed, so it fails if PostHog
// passes on a Request whose body has already been used. Browser code uses `window.Request` because this file
// imports Playwright's `Request` type under the same name.
async function installRequestRebuildingFetchWrapper(page: Page) {
    await page.addInitScript(() => {
        const nativeFetch = window.fetch
        window.fetch = function (this: Window, input: RequestInfo | URL, init?: RequestInit) {
            return nativeFetch.call(this, new window.Request(input, init))
        }
    })
}

test.describe('tracing headers with a distinct ID that cannot be a header value', () => {
    test('sends fetch and XHR requests with their bodies and no PostHog headers', async ({ page, context }) => {
        const received: Array<{ path: string; method: string; body: string | null; headers: Record<string, string> }> =
            []
        await context.route(`**${UNSENDABLE_ID_URL}/**`, async (route) => {
            const request = route.request()
            received.push({
                path: new URL(request.url()).pathname.slice(UNSENDABLE_ID_URL.length + 1),
                method: request.method(),
                body: request.postData(),
                headers: request.headers(),
            })
            await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
        })
        await installRequestRebuildingFetchWrapper(page)

        await start(
            { options: { tracing_headers: ['localhost'] }, url: '/playground/cypress/index.html' },
            page,
            context
        )
        await page.waitForFunction(() => {
            const win = window as any
            return win.__PosthogExtensions__?.tracingHeadersPatchFns && win.posthog
        })
        await page.evaluate(() => (window as any).posthog.identify('用户-1'))

        const results = await page.evaluate(async (baseUrl) => {
            const settle = async (send: () => Promise<{ status: number; body: string }>) => {
                try {
                    return await send()
                } catch (error) {
                    return { error: String(error) }
                }
            }
            const headers = { 'x-app-header': 'app-value' }
            return {
                fetchRequest: await settle(async () => {
                    const response = await fetch(
                        new window.Request(`${baseUrl}/fetch-request`, {
                            method: 'POST',
                            body: 'request body',
                            headers,
                        })
                    )
                    return { status: response.status, body: await response.text() }
                }),
                fetchUrl: await settle(async () => {
                    const response = await fetch(`${baseUrl}/fetch-url`, { method: 'POST', body: 'url body', headers })
                    return { status: response.status, body: await response.text() }
                }),
                xhr: await settle(
                    () =>
                        new Promise((resolve, reject) => {
                            const xhr = new XMLHttpRequest()
                            xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText })
                            xhr.onerror = () => reject(new Error('XHR failed'))
                            xhr.open('POST', `${baseUrl}/xhr`)
                            xhr.setRequestHeader('x-app-header', 'app-value')
                            xhr.send('xhr body')
                        })
                ),
            }
        }, UNSENDABLE_ID_URL)

        expect(results).toEqual({
            fetchRequest: { status: 200, body: 'ok' },
            fetchUrl: { status: 200, body: 'ok' },
            xhr: { status: 200, body: 'ok' },
        })
        expect(received.map(({ path, method, body }) => ({ path, method, body }))).toEqual([
            { path: 'fetch-request', method: 'POST', body: 'request body' },
            { path: 'fetch-url', method: 'POST', body: 'url body' },
            { path: 'xhr', method: 'POST', body: 'xhr body' },
        ])
        for (const { headers } of received) {
            expect(headers['x-app-header']).toBe('app-value')
            expect(headers['x-posthog-distinct-id']).toBeUndefined()
            expect(headers['x-posthog-session-id']).toBeUndefined()
            expect(headers['x-posthog-window-id']).toBeUndefined()
        }
    })
})

const CONSENT_URL = '/__posthog_tracing_consent_test'

test.describe('tracing headers across consent changes in cookieless on_reject', () => {
    test('follows the session manager that opting in creates and opting out removes', async ({ page, context }) => {
        const received: Array<{ path: string; body: string | null; headers: Record<string, string> }> = []
        await context.route(`**${CONSENT_URL}/**`, async (route) => {
            const request = route.request()
            received.push({
                path: new URL(request.url()).pathname.slice(CONSENT_URL.length + 1),
                body: request.postData(),
                headers: request.headers(),
            })
            await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
        })
        await installRequestRebuildingFetchWrapper(page)

        await start(
            {
                options: {
                    tracing_headers: ['localhost'],
                    cookieless_mode: 'on_reject',
                    opt_out_capturing_by_default: true,
                },
                url: '/playground/cypress/index.html',
            },
            page,
            context
        )
        await page.waitForFunction(() => {
            const win = window as any
            return win.__PosthogExtensions__?.tracingHeadersPatchFns && win.posthog
        })

        const sendBoth = (step: string) =>
            page.evaluate(
                async ({ baseUrl, step }) => {
                    const response = await fetch(`${baseUrl}/${step}-fetch`, { method: 'POST', body: 'fetch body' })
                    const xhrStatus = await new Promise<number>((resolve, reject) => {
                        const xhr = new XMLHttpRequest()
                        xhr.onload = () => resolve(xhr.status)
                        xhr.onerror = () => reject(new Error('XHR failed'))
                        xhr.open('POST', `${baseUrl}/${step}-xhr`)
                        xhr.send('xhr body')
                    })
                    return [response.status, xhrStatus]
                },
                { baseUrl: CONSENT_URL, step }
            )
        const liveIds = () =>
            page.evaluate(() => (window as any).posthog.sessionManager.checkAndGetSessionAndWindowId(true))

        expect(await sendBoth('rejected')).toEqual([200, 200])

        await page.evaluate(() => (window as any).posthog.opt_in_capturing())
        const optedInIds = await liveIds()
        expect(await sendBoth('opted-in')).toEqual([200, 200])

        await page.evaluate(() => (window as any).posthog.opt_out_capturing())
        expect(await sendBoth('opted-out')).toEqual([200, 200])

        await page.evaluate(() => (window as any).posthog.opt_in_capturing())
        const reOptedInIds = await liveIds()
        expect(await sendBoth('re-opted-in')).toEqual([200, 200])

        const sessionHeaders = (step: string) =>
            received
                .filter(({ path }) => path.startsWith(`${step}-`))
                .map(({ path, body, headers }) => ({
                    path,
                    body,
                    sessionId: headers['x-posthog-session-id'],
                    windowId: headers['x-posthog-window-id'],
                }))
        const expected = (step: string, ids?: { sessionId: string; windowId: string }) => [
            { path: `${step}-fetch`, body: 'fetch body', sessionId: ids?.sessionId, windowId: ids?.windowId },
            { path: `${step}-xhr`, body: 'xhr body', sessionId: ids?.sessionId, windowId: ids?.windowId },
        ]

        expect(optedInIds.sessionId).toBeTruthy()
        expect(reOptedInIds.sessionId).toBeTruthy()
        expect(sessionHeaders('rejected')).toEqual(expected('rejected'))
        expect(sessionHeaders('opted-in')).toEqual(expected('opted-in', optedInIds))
        expect(sessionHeaders('opted-out')).toEqual(expected('opted-out'))
        expect(sessionHeaders('re-opted-in')).toEqual(expected('re-opted-in', reOptedInIds))
    })
})

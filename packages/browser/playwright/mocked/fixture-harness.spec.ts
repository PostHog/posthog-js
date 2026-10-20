import { expect } from '@playwright/test'
import { testPage as test } from '../fixtures/page'
import { NetworkPage } from '../fixtures/network'

for (const helper of ['page', 'network'] as const) {
    test.describe(`${helper} fixture network waits`, () => {
        test.beforeEach(async ({ page }) => {
            await page.route('**/harness-*', (route) => route.fulfill({ body: 'ok', contentType: 'text/html' }))
            await page.goto('/harness-page')
        })

        test('waits for every response', async ({ page }) => {
            const target = helper === 'page' ? page : new NetworkPage(page)
            await target.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/harness-first', '**/harness-second'],
                action: async () => {
                    await page.evaluate(async () => {
                        await fetch('/harness-first')
                        await fetch('/harness-second')
                    })
                },
            })
        })

        test('rejects when a required response is missing', async ({ page }) => {
            const target = helper === 'page' ? page : new NetworkPage(page)
            page.setDefaultTimeout(500)
            await expect(
                target.waitingForNetworkCausedBy({
                    urlPatternsToWaitFor: ['**/harness-first', '**/harness-missing'],
                    action: async () => {
                        await page.evaluate(() => fetch('/harness-first').then(() => undefined))
                    },
                })
            ).rejects.toThrow(/page.waitForResponse: Timeout.*exceeded/)
        })

        for (const synchronous of [false, true]) {
            test(`propagates ${synchronous ? 'synchronous throws' : 'action rejection'} with pending waits`, async ({
                page,
            }) => {
                const target = helper === 'page' ? page : new NetworkPage(page)
                const error = new Error('action failed')
                page.setDefaultTimeout(100)
                await expect(
                    target.waitingForNetworkCausedBy({
                        urlPatternsToWaitFor: ['**/harness-missing'],
                        action: synchronous
                            ? () => {
                                  throw error
                              }
                            : () => Promise.reject(error),
                    })
                ).rejects.toBe(error)
                await page.waitForTimeout(150)
            })
        }
    })
}

test('network fixture serves script fallback, JSON config and versioned assets locally', async ({ page }) => {
    const network = new NetworkPage(page)
    await network.mockFlags({ autocaptureExceptions: true })
    await network.mockStatic({ 'exception-autocapture.js': 'array.js' })
    await page.route('**/harness-page', (route) => route.fulfill({ body: 'ok', contentType: 'text/html' }))
    await page.goto('/harness-page')

    const responses = await page.evaluate(async () => {
        const script = await fetch('/array/test-token/config.js')
        const config = await fetch('/array/test-token/config')
        const assets = await Promise.all(
            ['/static/exception-autocapture.js', '/static/1.2.3/exception-autocapture.js'].map(async (url) => {
                const response = await fetch(url)
                return { status: response.status, source: response.headers.get('source') }
            })
        )
        return { script: await script.text(), config: await config.json(), assets }
    })
    expect(responses.script).toBe('')
    expect(responses.config.autocaptureExceptions).toBe(true)
    expect(responses.assets).toEqual([
        { status: 200, source: 'array.js' },
        { status: 200, source: 'array.js' },
    ])
    network.expectNoFailed()
})

test('network fixture detects observed HTTP failures', async ({ page }) => {
    await page.route('**/harness-page', (route) => route.fulfill({ body: 'ok', contentType: 'text/html' }))
    await page.goto('/harness-page')
    const network = new NetworkPage(page)
    await page.route('**/harness-response', (route) => route.fulfill({ status: 200, body: 'ok' }))
    await page.evaluate(() => fetch('/harness-response'))
    expect(network.responses).toHaveLength(1)
    expect(() => network.expectNoFailed()).not.toThrow()

    await page.route('**/harness-error', (route) => route.fulfill({ status: 500, body: 'failure' }))
    await page.evaluate(() => fetch('/harness-error'))
    expect(network.responses).toHaveLength(2)
    expect(() => network.expectNoFailed()).toThrow()
})

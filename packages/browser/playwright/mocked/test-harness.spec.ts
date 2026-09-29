import { test, expect } from './utils/posthog-playwright-test-base'

test.describe('network wait helper', () => {
    test('observes every response triggered during the action', async ({ page }) => {
        await page.route('**/harness-*', (route) => route.fulfill({ body: 'ok' }))
        await page.goto('/')

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/harness-first', '**/harness-second'],
            action: async () => {
                await page.evaluate(async () => {
                    await fetch('/harness-first')
                    await fetch('/harness-second')
                })
            },
        })
    })

    test('rejects if one required response never arrives', async ({ page }) => {
        await page.route('**/harness-present', (route) => route.fulfill({ body: 'ok' }))
        await page.goto('/')
        page.setDefaultTimeout(500)

        await expect(
            page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/harness-present', '**/harness-missing'],
                action: async () => {
                    await page.evaluate(() => fetch('/harness-present').then(() => undefined))
                },
            })
        ).rejects.toThrow(/page.waitForResponse: Timeout.*exceeded/)
    })

    test('propagates action failures while handling pending response waits', async ({ page }) => {
        page.setDefaultTimeout(100)
        const error = new Error('action failed')

        await expect(
            page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/harness-missing'],
                action: async () => {
                    throw error
                },
            })
        ).rejects.toBe(error)
    })
})

import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

test.describe('debug mode persistence', () => {
    test('debug mode persists across page reload via localStorage', async ({ page, context }) => {
        await start(
            {
                options: {},
                url: '/playground/cypress/index.html',
            },
            page,
            context
        )

        await page.evaluate(() => {
            const win = window as any
            win.posthog?.debug()
        })

        const storedValue = await page.evaluate(() => localStorage.getItem('ph_debug'))
        expect(storedValue).not.toBeNull()

        await start(
            {
                options: { debug: undefined },
                type: 'reload',
                url: '/playground/cypress/index.html',
            },
            page,
            context
        )

        const debugAfterReload = await page.evaluate(() => {
            const win = window as any
            return win.posthog?.config?.debug
        })
        expect(debugAfterReload).toBe(true)
    })
})

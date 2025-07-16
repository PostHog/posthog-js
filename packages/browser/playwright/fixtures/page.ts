import { test as base, Page } from '@playwright/test'

export type WaitOptions = {
    pollInterval: number
    attempts: number
    maxAttempts: number
}

export interface BasePage extends Page {
    delay(ms: number): Promise<void>
    createFunctionHandle(fn: Function): Promise<string>
    waitForCondition(condition: () => boolean | Promise<boolean>, options?: Partial<WaitOptions>): Promise<void>
}

export const testPage = base.extend<{ page: BasePage; url: string | undefined }>({
    url: [undefined, { option: true }],
    page: async ({ page, url }, use) => {
        page.delay = async (ms: number) => {
            await new Promise((resolve) => setTimeout(resolve, ms))
        }
        page.createFunctionHandle = async (fn: Function): Promise<string> => {
            const id = Math.random().toString(36).substring(2, 15)
            await page.exposeFunction(id, fn)
            return id
        }
        page.waitForCondition = async (
            condition: () => boolean | Promise<boolean>,
            { pollInterval = 100, attempts = 0, maxAttempts = 100 } = {}
        ) => {
            if (await condition()) return
            if (attempts >= maxAttempts) throw new Error('Max attempts reached')
            await page.delay(pollInterval)
            await page.waitForCondition(condition, { pollInterval, attempts: attempts + 1, maxAttempts })
        }
        if (url) {
            await page.goto(url, { waitUntil: 'networkidle' })
        }
        await use(page)
        await page.close()
    },
})

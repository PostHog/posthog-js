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
    waitingForNetworkCausedBy(options: {
        urlPatternsToWaitFor: (string | RegExp)[]
        action: () => Promise<void>
    }): Promise<void>
    reloadIdle: () => Promise<void>
}

export const testPage = base.extend<{ page: BasePage; url: string | undefined }>({
    url: [undefined, { option: true }],
    page: async ({ page, url }, use) => {
        await page.clock.install()
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
        page.waitingForNetworkCausedBy = async function (options: {
            urlPatternsToWaitFor: (string | RegExp)[]
            action: () => Promise<void>
        }) {
            const responsePromises = options.urlPatternsToWaitFor.map((urlPattern) => {
                return this.waitForResponse(urlPattern)
            })
            await options.action()
            // eslint-disable-next-line compat/compat
            await Promise.allSettled(responsePromises)
        }
        page.reloadIdle = async () => {
            await page.reload({ waitUntil: 'networkidle' })
        }
        if (url) {
            await page.goto(url, { waitUntil: 'networkidle' })
        }
        await use(page)
        await page.clock.install()
        await page.close()
    },
})

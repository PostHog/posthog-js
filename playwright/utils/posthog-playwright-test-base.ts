import { test as base, Page, expect } from '@playwright/test'
import { PostHog } from '../../src/posthog-core'
import { CaptureResult } from '../../src/types'

const lazyLoadedJSFiles = [
    'array',
    'array.full',
    'recorder',
    'surveys',
    'exception-autocapture',
    'tracing-headers',
    'web-vitals',
    'dead-clicks-autocapture',
]

export type WindowWithPostHog = typeof globalThis & {
    posthog?: PostHog
    capturedEvents?: CaptureResult[]
}

declare module '@playwright/test' {
    /*
     to support tests running in parallel
     we keep captured events in the window object
     for a page with custom methods added
     to the Playwright Page object
    */
    interface Page {
        resetCapturedEvents(): Promise<void>

        capturedEvents(): Promise<CaptureResult[]>

        waitingForNetworkCausedBy: (urlPatterns: (string | RegExp)[], action: () => Promise<void>) => Promise<void>

        expectCapturedEventsToBe(expectedEvents: string[]): Promise<void>
    }
}

export const test = base.extend<{ mockStaticAssets: void; page: Page }>({
    page: async ({ page }, use) => {
        // Add custom methods to the page object
        page.resetCapturedEvents = async function () {
            await this.evaluate(() => {
                ;(window as WindowWithPostHog).capturedEvents = []
            })
        }
        page.capturedEvents = async function () {
            return this.evaluate(() => {
                return (window as WindowWithPostHog).capturedEvents || []
            })
        }
        page.waitingForNetworkCausedBy = async function (
            urlPatterns: (string | RegExp)[],
            action: () => Promise<void>
        ) {
            const responsePromises = urlPatterns.map((urlPattern) => {
                return this.waitForResponse(urlPattern)
            })

            await action()

            // eslint-disable-next-line compat/compat
            await Promise.allSettled(responsePromises)
        }
        page.expectCapturedEventsToBe = async function (expectedEvents: string[]) {
            const capturedEvents = await this.capturedEvents()
            expect(capturedEvents.map((x) => x.event)).toEqual(expectedEvents)
        }

        // Pass the extended page to the test
        await use(page)
    },
    mockStaticAssets: [
        async ({ context }, use) => {
            // also equivalent of cy.intercept('GET', '/surveys/*').as('surveys') ??
            void context.route('**/e/*', (route) => {
                route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ status: 1 }),
                    headers: {
                        'Access-Control-Allow-Headers': '*',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Credentials': 'true',
                    },
                })
            })

            void context.route('**/ses/*', (route) => {
                route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ status: 1 }),
                })
            })

            lazyLoadedJSFiles.forEach((key: string) => {
                void context.route(new RegExp(`^.*/static/${key}\\.js(\\?.*)?$`), (route) => {
                    route.fulfill({
                        headers: {
                            loaded: 'using relative path by playwright',
                        },
                        path: `./dist/${key}.js`,
                    })
                })

                void context.route(`**/static/${key}.js.map`, (route) => {
                    route.fulfill({
                        headers: { loaded: 'using relative path by playwright' },
                        path: `./dist/${key}.js.map`,
                    })
                })
            })

            await use()
            // there's no teardown, so nothing here
        },
        // auto so that tests don't need to remember they need this... every test needs it
        { auto: true },
    ],
})
export { expect } from '@playwright/test'

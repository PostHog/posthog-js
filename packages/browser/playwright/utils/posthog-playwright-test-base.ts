import { test as base, Page, expect } from '@playwright/test'
import { PostHog } from '../../src/posthog-core'
import { CaptureResult, PostHogConfig } from '../../src/types'

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
     to support tests running in parallel,
     we keep captured events in the window object
     for a page with custom methods added
     to the Playwright Page object
    */
    interface Page {
        resetCapturedEvents(): Promise<void>

        capturedEvents(): Promise<CaptureResult[]>
        /**
         * Runs the provided action, waiting for the network requests matching the provided url patterns to complete.
         * Intended when running an action causes network requests that need to complete before we should continue.
         */
        waitingForNetworkCausedBy: (options: {
            urlPatternsToWaitFor: (string | RegExp)[]
            action: () => Promise<void>
        }) => Promise<void>
        delay(ms: number): Promise<void>
        expectCapturedEventsToBe(expectedEvents: string[]): Promise<void>
        expectEventsCount(expectedCounts: Record<string, number>): Promise<void>
        posthog: {
            init: (token: string, options: Partial<PostHogConfig>) => Promise<void>
            register: (props: { [key: string]: any }) => Promise<void>
            waitToLoad: () => Promise<void>
        }
    }
}

export const extendPage = (page) => {
    page.delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

    // Add custom methods to the page object
    page.resetCapturedEvents = async function () {
        await this.evaluate(() => {
            ;(window as WindowWithPostHog).capturedEvents = []
        })
    }

    page.capturedEvents = async function (): Promise<CaptureResult[]> {
        return this.evaluate(() => {
            return (window as WindowWithPostHog).capturedEvents || []
        })
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

    page.expectEventsCount = async function (expectedCounts: Record<string, number>) {
        const capturedEvents: CaptureResult[] = await this.capturedEvents()
        const capturedMap = capturedEvents.reduce((agg, event) => {
            agg[event.event] = (agg[event.event] || 0) + 1
            return agg
        }, {})
        expect(capturedMap).toEqual(expect.objectContaining(expectedCounts))
    }

    page.expectCapturedEventsToBe = async function (expectedEvents: string[]) {
        const capturedEvents = await this.capturedEvents()
        expect(capturedEvents.map((x) => x.event)).toEqual(expectedEvents)
    }

    page.posthog = {
        async init(token: string, options: Partial<PostHogConfig>) {
            await page.evaluate(
                // TS very unhappy with passing PostHogConfig here, so just pass an object
                (args: Record<string, any>) => {
                    const opts: Partial<PostHogConfig> = {
                        api_host: args.options.api_host,
                        debug: args.options.debug ?? true,
                        ip: false, // Prevent IP deprecation warning in Playwright tests
                        before_send: (event) => {
                            const win = window as WindowWithPostHog
                            win.capturedEvents = win.capturedEvents || []

                            if (event) {
                                win.capturedEvents.push(event)
                            }

                            return event
                        },
                        loaded: (ph) => {
                            if (ph.sessionRecording) {
                                ph.sessionRecording._forceAllowLocalhostNetworkCapture = true
                            }
                            window.isLoaded = true
                            // playwright can't serialize functions to pass around from the playwright to browser context
                            // if we want to run custom code in the loaded function we need to pass it on the page's window,
                            // but it's a new window so we have to create it in the `before_posthog_init` option
                            ;(window as any).__ph_loaded?.(ph)
                        },
                        opt_out_useragent_filter: true,
                        ...args.options,
                    }

                    const windowPosthog = (window as WindowWithPostHog).posthog
                    windowPosthog?.init(args.token, opts)
                },
                { token, options } as { token: string; options: Record<string, any> }
            )
        },
        async register(records: Record<string, string>) {
            await page.evaluate(
                // TS very unhappy with passing PostHogConfig here, so just pass an object
                (args: Record<string, any>) => {
                    const windowPosthog = (window as WindowWithPostHog).posthog
                    windowPosthog?.register(args)
                },
                records
            )
        },
        async waitToLoad() {
            await page.evaluate(() => {
                return new Promise((resolve) => {
                    const checkLoaded = () => {
                        if (window?.isLoaded) {
                            resolve(true)
                        } else {
                            setTimeout(checkLoaded, 100)
                        }
                    }
                    checkLoaded()
                })
            })
        },
    }
}

export const test = base.extend<{ mockStaticAssets: void; page: Page }>({
    page: async ({ page }, use) => {
        extendPage(page)
        // Pass the extended page to the test
        await use(page)
    },
    mockStaticAssets: [
        async ({ context }, use) => {
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

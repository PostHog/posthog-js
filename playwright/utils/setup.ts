import { Page, BrowserContext } from '@playwright/test'
import { CaptureResult, Compression, DecideResponse, PostHogConfig } from '../../src/types'
import { PostHog } from '../../src/posthog-core'
import path from 'path'

export const captures: string[] = []
export const fullCaptures: CaptureResult[] = []

export const resetCaptures = () => {
    captures.length = 0
    fullCaptures.length = 0
}

export type WindowWithPostHog = typeof globalThis & {
    posthog?: PostHog
}

export async function start(
    {
        waitForDecide = true,
        initPosthog = true,
        resetOnInit = false,
        type = 'navigate',
        options = {},
        decideResponseOverrides = {
            sessionRecording: undefined,
            isAuthenticated: false,
            capturePerformance: true,
        },
        url = './playground/cypress-full/index.html',
    }: {
        waitForDecide?: boolean
        initPosthog?: boolean
        resetOnInit?: boolean
        type?: 'navigate' | 'reload'
        options?: Partial<PostHogConfig>
        decideResponseOverrides?: Partial<DecideResponse>
        url?: string
    },
    page: Page,
    context: BrowserContext
) {
    options.opt_out_useragent_filter = true

    // Prepare the mocked Decide API response
    const decideResponse: DecideResponse = {
        editorParams: {},
        featureFlags: { 'session-recording-player': true },
        featureFlagPayloads: {},
        errorsWhileComputingFlags: false,
        toolbarParams: {},
        toolbarVersion: 'toolbar',
        isAuthenticated: false,
        siteApps: [],
        supportedCompression: [Compression.GZipJS],
        autocaptureExceptions: false,
        ...decideResponseOverrides,
    }

    // allow promise in e2e tests
    // eslint-disable-next-line compat/compat
    const decideMock = new Promise((resolve) => {
        void context.route('**/decide/*', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(decideResponse),
            })
            resolve('mock network to decide was triggered')
        })
    })

    if (type === 'reload') {
        await page.reload()
    } else {
        // Visit the specified URL
        if (url.startsWith('./')) {
            const filePath = path.resolve(process.cwd(), url)
            // starts with a single slash since otherwise we get three
            url = `file://${filePath}`
        }
        await page.goto(url)
    }

    // Initialize PostHog if required
    if (initPosthog) {
        // not safe to exposeFunction twice, so check if it's already there
        const hasFunctionAlready = await page.evaluate(() => {
            // eslint-disable-next-line posthog-js/no-direct-undefined-check
            return (window as any).addToFullCaptures !== undefined
        })
        if (!hasFunctionAlready) {
            await page.exposeFunction('addToFullCaptures', (event: any) => {
                captures.push(event.event)
                fullCaptures.push(event)
            })
        }

        await page.evaluate(
            // TS very unhappy with passing PostHogConfig here, so just pass an object
            (posthogOptions: Record<string, any>) => {
                const opts: Partial<PostHogConfig> = {
                    api_host: 'https://localhost:1234',
                    debug: true,
                    before_send: (event) => {
                        if (event) {
                            ;(window as any).addToFullCaptures(event)
                        }
                        return event
                    },
                    opt_out_useragent_filter: true,
                    ...posthogOptions,
                }

                const windowPosthog = (window as WindowWithPostHog).posthog
                windowPosthog?.init('test token', opts)
            },
            options as Record<string, any>
        )
    }

    // Reset PostHog if required
    if (resetOnInit) {
        await page.evaluate(() => {
            const windowPosthog = (window as WindowWithPostHog).posthog
            windowPosthog?.reset(true)
        })
    }

    // Wait for `/decide` response if required
    if (waitForDecide) {
        await decideMock
    }
}

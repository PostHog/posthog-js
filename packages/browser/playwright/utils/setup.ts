import { Page, BrowserContext } from '@playwright/test'
import { Compression, FlagsResponse, PostHogConfig } from '../../src/types'
import path from 'path'
import { WindowWithPostHog } from './posthog-playwright-test-base'

/**
 * uses the standard playwright page.goto
 * but if the URL starts with './'
 * treats it as a relative file path
 *
 */
export async function gotoPage(page: Page, url: string) {
    // Visit the specified URL
    if (url.startsWith('./')) {
        const filePath = path.resolve(process.cwd(), url)
        // starts with a single slash since otherwise we get three
        url = `file://${filePath}`
    }
    await page.goto(url)
}

export interface StartOptions {
    waitForFlags?: boolean
    initPosthog?: boolean
    resetOnInit?: boolean
    // playwright is stricter than cypress on access to the window object
    // sometimes you need to pass functions here that will run on window in the correct page
    runBeforePostHogInit?: (pg: Page) => void
    // playwright is stricter than cypress on access to the window object
    // sometimes you need to pass functions here that will run on window in the correct page
    runAfterPostHogInit?: (pg: Page) => void
    type?: 'navigate' | 'reload'
    options?: Partial<PostHogConfig>
    flagsResponseOverrides?: Partial<FlagsResponse>
    url?: string
}

export async function start(
    {
        waitForFlags = true,
        initPosthog = true,
        resetOnInit = false,
        runBeforePostHogInit = undefined,
        runAfterPostHogInit = undefined,
        type = 'navigate',
        options = {},
        flagsResponseOverrides = {
            sessionRecording: undefined,
            isAuthenticated: false,
            capturePerformance: true,
        },
        url = '/playground/cypress-full/index.html',
    }: StartOptions,
    page: Page,
    context: BrowserContext
) {
    options.opt_out_useragent_filter = true

    // Prepare the mocked Flags API response
    const flagsResponse: FlagsResponse = {
        editorParams: {},
        flags: {
            'session-recording-player': {
                key: '7569-insight-cohorts',
                enabled: true,
                variant: undefined,
                reason: {
                    code: 'condition_match',
                    condition_index: 0,
                    description: 'Matched condition set 1',
                },
                metadata: {
                    id: 1421,
                    version: 1,
                    description: undefined,
                    payload: undefined,
                },
            },
        },
        featureFlags: { 'session-recording-player': true },
        featureFlagPayloads: {},
        errorsWhileComputingFlags: false,
        toolbarParams: {},
        toolbarVersion: 'toolbar',
        isAuthenticated: false,
        siteApps: [],
        supportedCompression: [Compression.GZipJS],
        autocaptureExceptions: false,
        ...flagsResponseOverrides,
    }

    // allow promise in e2e tests
    // eslint-disable-next-line compat/compat
    const flagsMock = new Promise((resolve) => {
        void context.route('**/flags/*', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(flagsResponse),
            })
            resolve('mock network to flags was triggered')
        })
    })

    if (type === 'reload') {
        await page.reload()
    } else {
        await gotoPage(page, url)
    }

    runBeforePostHogInit?.(page)

    // Initialize PostHog if required
    if (initPosthog) {
        await page.evaluate(
            // TS very unhappy with passing PostHogConfig here, so just pass an object
            (posthogOptions: Record<string, any>) => {
                const opts: Partial<PostHogConfig> = {
                    api_host: 'https://localhost:1234',
                    debug: true,
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
                        // playwright can't serialize functions to pass around from the playwright to browser context
                        // if we want to run custom code in the loaded function we need to pass it on the page's window,
                        // but it's a new window so we have to create it in the `before_posthog_init` option
                        ;(window as any).__ph_loaded?.(ph)
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

    runAfterPostHogInit?.(page)

    // Reset PostHog if required
    if (resetOnInit) {
        await page.evaluate(() => {
            const windowPosthog = (window as WindowWithPostHog).posthog
            windowPosthog?.reset(true)
        })
    }

    // Wait for `/flags` response if required
    if (waitForFlags) {
        await flagsMock
    }
}

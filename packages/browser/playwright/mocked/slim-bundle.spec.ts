/* eslint-disable no-console */
import { test, expect } from './utils/posthog-playwright-test-base'
import { Compression, FlagsResponse, PostHogConfig } from '@/types'
import { PostHog } from '@/posthog-core'

/**
 * Regression test for https://github.com/PostHog/posthog-js/issues/3313
 *
 * When users import the slim bundle (`posthog-js/dist/module.slim`) together with
 * extension bundles (`posthog-js/dist/extension-bundles`), property mangling can
 * cause crashes because the two files are compiled as separate rollup entries and
 * terser may mangle `_`-prefixed properties to different names in each bundle.
 *
 * For example, `_internalEventEmitter` might be mangled to `ti` in extension-bundles
 * but `oe` in module.slim, so `PostHogFeatureFlags.reloadFeatureFlags()` crashes with:
 *   TypeError: Cannot read properties of undefined (reading 'emit')
 *
 * module.slim.no-external intentionally preserves private property names, so the
 * extension bundle must reserve every private property exchanged across that boundary.
 */

const SLIM_BUNDLE_URL = '/playground/slim-bundle/index.html'
const SLIM_BUNDLES = [
    { name: 'module.slim.js', url: SLIM_BUNDLE_URL },
    { name: 'module.slim.no-external.js', url: `${SLIM_BUNDLE_URL}?bundle=no-external` },
] as const

/** Helper: wait for ES modules on the page to finish loading. */
async function waitForSlimBundleReady(page: import('@playwright/test').Page) {
    await page.waitForFunction(() => (window as any).__slim_bundle_ready === true, null, { timeout: 5000 })
}

/** Helper: init PostHog on the page with the given extension bundle(s). */
async function initPostHogWithExtensions(
    page: import('@playwright/test').Page,
    extensionVarName: string,
    extraConfig: Record<string, any> = {}
) {
    return page.evaluate(
        ([extName, extra]) => {
            try {
                const ph = (window as any).posthog as PostHog
                const extensions = (window as any)[extName]
                ph.init('test-token', {
                    api_host: 'https://localhost:1234',
                    debug: true,
                    ip: false,
                    capture_pageview: false,
                    __extensionClasses: { ...extensions },
                    opt_out_useragent_filter: true,
                    ...extra,
                } as Partial<PostHogConfig>)
                return null
            } catch (e: any) {
                return e.message
            }
        },
        [extensionVarName, extraConfig] as const
    )
}

test.describe('slim bundle + extension bundles (#3313)', () => {
    test.beforeEach(async ({ context }) => {
        // Mock the remote config endpoint
        void context.route(/\/array\/[^/]+\/config(\?|$)/, (route) => {
            const flagsResponse: FlagsResponse = {
                editorParams: {},
                flags: {},
                featureFlags: {},
                featureFlagPayloads: {},
                errorsWhileComputingFlags: false,
                toolbarParams: {},
                toolbarVersion: 'toolbar',
                isAuthenticated: false,
                siteApps: [],
                supportedCompression: [Compression.GZipJS],
                autocaptureExceptions: false,
            }
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(flagsResponse),
            })
        })

        // Mock the flags endpoint
        void context.route('**/flags/*', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    featureFlags: { 'test-flag': true },
                    featureFlagPayloads: {},
                    errorsWhileComputingFlags: false,
                }),
            })
        })

        // Mock the capture endpoint
        void context.route('**/e/*', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ status: 1 }),
            })
        })

        // Mock the surveys endpoint
        void context.route('**/api/surveys/*', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ surveys: [] }),
            })
        })
    })

    for (const slimBundle of SLIM_BUNDLES) {
        test.describe(slimBundle.name, () => {
            // ── FeatureFlagsExtensions ──────────────────────────────────────────

            test('FeatureFlagsExtensions: init does not crash', async ({ page }) => {
                const errors: string[] = []
                page.on('pageerror', (error) => errors.push(error.message))

                await page.goto(slimBundle.url)
                await waitForSlimBundleReady(page)

                const initError = await initPostHogWithExtensions(page, 'FeatureFlagsExtensions')
                await page.waitForTimeout(1000)

                expect(initError).toBeNull()
                expect(errors).toEqual([])
            })

            test('FeatureFlagsExtensions: reloadFeatureFlags does not crash', async ({ page }) => {
                const errors: string[] = []
                page.on('pageerror', (error) => errors.push(error.message))

                await page.goto(slimBundle.url)
                await waitForSlimBundleReady(page)

                const error = await page.evaluate(() => {
                    try {
                        const ph = (window as any).posthog as PostHog
                        const extensions = (window as any).FeatureFlagsExtensions
                        ph.init('test-token', {
                            api_host: 'https://localhost:1234',
                            debug: true,
                            ip: false,
                            capture_pageview: false,
                            __extensionClasses: { ...extensions },
                            opt_out_useragent_filter: true,
                        } as Partial<PostHogConfig>)
                        ph.reloadFeatureFlags()
                        return null
                    } catch (e: any) {
                        return e.message
                    }
                })

                await page.waitForTimeout(1000)
                expect(error).toBeNull()
                expect(errors).toEqual([])
            })

            test('FeatureFlagsExtensions: getFeatureFlag works with bootstrapped flags', async ({ page }) => {
                const errors: string[] = []
                page.on('pageerror', (error) => errors.push(error.message))

                await page.goto(slimBundle.url)
                await waitForSlimBundleReady(page)

                const flagValue = await page.evaluate(() => {
                    try {
                        const ph = (window as any).posthog as PostHog
                        const extensions = (window as any).FeatureFlagsExtensions
                        ph.init('test-token', {
                            api_host: 'https://localhost:1234',
                            debug: true,
                            ip: false,
                            capture_pageview: false,
                            __extensionClasses: { ...extensions },
                            opt_out_useragent_filter: true,
                            bootstrap: { featureFlags: { 'test-flag': true } },
                        } as Partial<PostHogConfig>)
                        return { value: ph.getFeatureFlag('test-flag'), error: null }
                    } catch (e: any) {
                        return { value: null, error: e.message }
                    }
                })

                expect(flagValue.error).toBeNull()
                expect(flagValue.value).toBe(true)
                expect(errors).toEqual([])
            })

            // ── ErrorTrackingExtensions ─────────────────────────────────────────

            test('ErrorTrackingExtensions: captureException does not crash', async ({ page }) => {
                const errors: string[] = []
                page.on('pageerror', (error) => errors.push(error.message))

                await page.goto(slimBundle.url)
                await waitForSlimBundleReady(page)

                const error = await page.evaluate(() => {
                    try {
                        const ph = (window as any).posthog as PostHog
                        const extensions = (window as any).ErrorTrackingExtensions
                        ph.init('test-token', {
                            api_host: 'https://localhost:1234',
                            debug: true,
                            ip: false,
                            capture_pageview: false,
                            __extensionClasses: { ...extensions },
                            opt_out_useragent_filter: true,
                        } as Partial<PostHogConfig>)
                        ph.captureException(new Error('test error'), { extra: 'data' })
                        return null
                    } catch (e: any) {
                        return e.message
                    }
                })

                await page.waitForTimeout(1000)
                expect(error).toBeNull()
                expect(errors).toEqual([])
            })

            // ── ToolbarExtensions ───────────────────────────────────────────────

            test('ToolbarExtensions: loadToolbar does not crash', async ({ page }) => {
                const errors: string[] = []
                page.on('pageerror', (error) => errors.push(error.message))

                await page.goto(slimBundle.url)
                await waitForSlimBundleReady(page)

                const error = await page.evaluate(() => {
                    try {
                        const ph = (window as any).posthog as PostHog
                        const extensions = (window as any).ToolbarExtensions
                        ph.init('test-token', {
                            api_host: 'https://localhost:1234',
                            debug: true,
                            ip: false,
                            capture_pageview: false,
                            __extensionClasses: { ...extensions },
                            opt_out_useragent_filter: true,
                        } as Partial<PostHogConfig>)
                        // loadToolbar returns false when there are no toolbar params — that's fine,
                        // we just want to make sure it doesn't throw.
                        ph.loadToolbar({})
                        return null
                    } catch (e: any) {
                        return e.message
                    }
                })

                await page.waitForTimeout(1000)
                expect(error).toBeNull()
                expect(errors).toEqual([])
            })

            // ── SurveysExtensions ───────────────────────────────────────────────

            test('SurveysExtensions: getSurveys does not crash', async ({ page }) => {
                const errors: string[] = []
                page.on('pageerror', (error) => errors.push(error.message))

                await page.goto(slimBundle.url)
                await waitForSlimBundleReady(page)

                const error = await page.evaluate(() => {
                    return new Promise<string | null>((resolve) => {
                        try {
                            const ph = (window as any).posthog as PostHog
                            const extensions = (window as any).SurveysExtensions
                            ph.init('test-token', {
                                api_host: 'https://localhost:1234',
                                debug: true,
                                ip: false,
                                capture_pageview: false,
                                __extensionClasses: { ...extensions },
                                opt_out_useragent_filter: true,
                            } as Partial<PostHogConfig>)
                            ph.getSurveys(() => {
                                resolve(null)
                            })
                        } catch (e: any) {
                            resolve(e.message)
                        }
                    })
                })

                await page.waitForTimeout(1000)
                expect(error).toBeNull()
                expect(errors).toEqual([])
            })

            // ── AnalyticsExtensions (Autocapture) ─────────────────────────────

            test('AnalyticsExtensions: autocapture init does not crash', async ({ page }) => {
                // Autocapture accesses this.instance._shouldDisableFlags() which is mangled
                const errors: string[] = []
                page.on('pageerror', (error) => errors.push(error.message))

                await page.goto(slimBundle.url)
                await waitForSlimBundleReady(page)

                const error = await page.evaluate(() => {
                    try {
                        const ph = (window as any).posthog as PostHog
                        const extensions = (window as any).AnalyticsExtensions
                        ph.init('test-token', {
                            api_host: 'https://localhost:1234',
                            debug: true,
                            ip: false,
                            capture_pageview: false,
                            autocapture: true,
                            __extensionClasses: { ...extensions },
                            opt_out_useragent_filter: true,
                        } as Partial<PostHogConfig>)
                        return null
                    } catch (e: any) {
                        return e.message
                    }
                })

                await page.waitForTimeout(1000)
                expect(error).toBeNull()
                expect(errors).toEqual([])
            })

            // ── LogsExtensions ───────────────────────────────────────────────

            test('without LogsExtensions: logs stay absent and console stays unwrapped', async ({ page }) => {
                const errors: string[] = []
                const logsRequests: string[] = []
                page.on('pageerror', (error) => errors.push(error.message))
                page.on('request', (request) => {
                    if (/\/static\/logs\.js(?:\?|$)/.test(request.url())) {
                        logsRequests.push(request.url())
                    }
                })

                await page.goto(slimBundle.url)
                await waitForSlimBundleReady(page)

                const result = await page.evaluate(() => {
                    const ph = (window as any).posthog as PostHog
                    const originalWarn = console.warn
                    ph.init('test-token', {
                        api_host: 'http://localhost:2345',
                        capture_pageview: false,
                        __extensionClasses: {},
                        logs: { captureConsoleLogs: true },
                    } as Partial<PostHogConfig>)
                    console.warn('slim bundle without logs')
                    return {
                        hasLogs: ph.logs !== undefined,
                        consoleWrapped: console.warn !== originalWarn,
                    }
                })
                await page.waitForTimeout(100)

                expect(result).toEqual({ hasLogs: false, consoleWrapped: false })
                expect(logsRequests).toEqual([])
                expect(errors).toEqual([])
            })

            test('with LogsExtensions: captures a console record through the lazy bundle', async ({ page }) => {
                const errors: string[] = []
                const logsRequests: string[] = []
                page.on('pageerror', (error) => errors.push(error.message))
                page.on('request', (request) => {
                    if (/\/static\/logs\.js(?:\?|$)/.test(request.url())) {
                        logsRequests.push(request.url())
                    }
                })

                await page.goto(slimBundle.url)
                await waitForSlimBundleReady(page)
                if (slimBundle.name === 'module.slim.no-external.js') {
                    // The no-external build omits the lazy-script loader by design.
                    await page.addScriptTag({ url: '/dist/external-scripts-loader.js' })
                }

                const error = await initPostHogWithExtensions(page, 'LogsExtensions', {
                    api_host: 'http://localhost:2345',
                })
                expect(error).toBeNull()

                await page.evaluate(() => {
                    const logs = (window as any).posthog.logs
                    logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: true } } })
                })
                // Spy on both hand-off points rather than probing a console wrapper: the
                // pre-load recorder marks its wrapper the same way the lazy bundle does, so
                // the marker says nothing about which one is installed. A call made before
                // the bundle takes over is buffered and replayed through
                // `captureBufferedConsoleLog`; one made after goes straight to
                // `captureConsoleLog`. Both carry the same record, and both names survive
                // property mangling, which is why the bundle calls them by name.
                await page.evaluate(() => {
                    const logs = (window as any).posthog.logs
                    const live = logs.captureConsoleLog.bind(logs)
                    const buffered = logs.captureBufferedConsoleLog.bind(logs)
                    logs.captureConsoleLog = (options: any) => {
                        ;(window as any).__consoleRecord ??= options
                        return live(options)
                    }
                    logs.captureBufferedConsoleLog = (options: any, ...rest: any[]) => {
                        ;(window as any).__consoleRecord ??= options
                        return buffered(options, ...rest)
                    }
                    console.warn('slim bundle logs smoke')
                })

                await expect.poll(() => page.evaluate(() => (window as any).__consoleRecord ?? null)).not.toBeNull()
                const captured = await page.evaluate(() => (window as any).__consoleRecord)

                expect(captured).toEqual(
                    expect.objectContaining({
                        level: 'warn',
                        body: '"slim bundle logs smoke"',
                        attributes: expect.objectContaining({ 'log.source': 'console.warn' }),
                    })
                )
                expect(logsRequests).toHaveLength(1)
                expect(errors).toEqual([])
            })

            // ── Every extension bundle: init does not crash ───────────────────

            for (const extName of [
                'SiteAppsExtensions',
                'SessionReplayExtensions',
                'ExperimentsExtensions',
                'ConversationsExtensions',
                'LogsExtensions',
                'ProductToursExtensions',
                'TracingExtensions',
            ] as const) {
                test(`${extName}: init does not crash`, async ({ page }) => {
                    const errors: string[] = []
                    page.on('pageerror', (error) => errors.push(error.message))

                    await page.goto(slimBundle.url)
                    await waitForSlimBundleReady(page)

                    const error = await initPostHogWithExtensions(page, extName)
                    await page.waitForTimeout(1000)

                    expect(error).toBeNull()
                    expect(errors).toEqual([])
                })
            }

            test('reported extension combination does not crash', async ({ page }) => {
                const errors: string[] = []
                page.on('pageerror', (error) => errors.push(error.message))

                await page.goto(slimBundle.url)
                await waitForSlimBundleReady(page)

                const error = await page.evaluate(() => {
                    try {
                        const ph = (window as any).posthog as PostHog
                        ph.init('test-token', {
                            api_host: 'https://localhost:1234',
                            debug: true,
                            ip: false,
                            capture_pageview: false,
                            autocapture: true,
                            __extensionClasses: {
                                ...(window as any).SessionReplayExtensions,
                                ...(window as any).AnalyticsExtensions,
                                ...(window as any).ErrorTrackingExtensions,
                            },
                            opt_out_useragent_filter: true,
                        } as Partial<PostHogConfig>)
                        ph.captureException(new Error('test error'))
                        return null
                    } catch (e: any) {
                        return e.message
                    }
                })

                await page.waitForTimeout(1000)
                expect(error).toBeNull()
                expect(errors).toEqual([])
            })

            test('conversations identity callbacks do not crash', async ({ page }) => {
                const errors: string[] = []
                page.on('pageerror', (error) => errors.push(error.message))

                await page.goto(slimBundle.url)
                await waitForSlimBundleReady(page)

                const error = await page.evaluate(() => {
                    try {
                        const ph = (window as any).posthog as PostHog
                        ph.init('test-token', {
                            api_host: 'https://localhost:1234',
                            debug: true,
                            ip: false,
                            capture_pageview: false,
                            __extensionClasses: { ...(window as any).ConversationsExtensions },
                            opt_out_useragent_filter: true,
                        } as Partial<PostHogConfig>)
                        ph.setIdentity('user_123', 'identity_hash')
                        ph.clearIdentity()
                        return null
                    } catch (e: any) {
                        return e.message
                    }
                })

                await page.waitForTimeout(1000)
                expect(error).toBeNull()
                expect(errors).toEqual([])
            })

            // ── AllExtensions ───────────────────────────────────────────────────

            test('AllExtensions: init + multiple features do not crash', async ({ page }) => {
                const errors: string[] = []
                page.on('pageerror', (error) => errors.push(error.message))

                await page.goto(slimBundle.url)
                await waitForSlimBundleReady(page)

                const result = await page.evaluate(() => {
                    try {
                        const ph = (window as any).posthog as PostHog
                        const extensions = (window as any).AllExtensions
                        ph.init('test-token', {
                            api_host: 'https://localhost:1234',
                            debug: true,
                            ip: false,
                            capture_pageview: false,
                            __extensionClasses: { ...extensions },
                            opt_out_useragent_filter: true,
                            bootstrap: { featureFlags: { 'test-flag': 'variant-a' } },
                        } as Partial<PostHogConfig>)

                        // Exercise multiple TreeShakeable<T> code paths in one test:
                        const flagValue = ph.getFeatureFlag('test-flag')
                        ph.reloadFeatureFlags()
                        ph.captureException(new Error('test error'))
                        ph.loadToolbar({})

                        return { flagValue, error: null }
                    } catch (e: any) {
                        return { flagValue: null, error: e.message }
                    }
                })

                await page.waitForTimeout(1000)
                expect(result.error).toBeNull()
                expect(result.flagValue).toBe('variant-a')
                expect(errors).toEqual([])
            })
        })
    }
})

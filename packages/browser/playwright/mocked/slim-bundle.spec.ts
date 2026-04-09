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
 */

const SLIM_BUNDLE_URL = '/playground/slim-bundle/index.html'

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

    // ── FeatureFlagsExtensions ──────────────────────────────────────────

    test('FeatureFlagsExtensions: init does not crash', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))

        await page.goto(SLIM_BUNDLE_URL)
        await waitForSlimBundleReady(page)

        const initError = await initPostHogWithExtensions(page, 'FeatureFlagsExtensions')
        await page.waitForTimeout(1000)

        expect(initError).toBeNull()
        expect(errors).toEqual([])
    })

    test('FeatureFlagsExtensions: reloadFeatureFlags does not crash', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))

        await page.goto(SLIM_BUNDLE_URL)
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

        await page.goto(SLIM_BUNDLE_URL)
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

        await page.goto(SLIM_BUNDLE_URL)
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

        await page.goto(SLIM_BUNDLE_URL)
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

        await page.goto(SLIM_BUNDLE_URL)
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

        await page.goto(SLIM_BUNDLE_URL)
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

            await page.goto(SLIM_BUNDLE_URL)
            await waitForSlimBundleReady(page)

            const error = await initPostHogWithExtensions(page, extName)
            await page.waitForTimeout(1000)

            expect(error).toBeNull()
            expect(errors).toEqual([])
        })
    }

    // ── AllExtensions ───────────────────────────────────────────────────

    test('AllExtensions: init + multiple features do not crash', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))

        await page.goto(SLIM_BUNDLE_URL)
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

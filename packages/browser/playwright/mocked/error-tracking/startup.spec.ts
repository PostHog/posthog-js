import { test, expect, WindowWithPostHog } from '../../fixtures'

for (const entrypoint of ['module', 'module.slim']) {
    for (const mode of ['local', 'remote-on', 'remote-off']) {
        test(`handles startup exceptions with ${entrypoint} and ${mode} enablement`, async ({ page, events }) => {
            const exceptionScriptRequests: string[] = []
            await page.route('**/exception-autocapture.js*', (route) => {
                exceptionScriptRequests.push(route.request().url())
                return route.abort()
            })
            await page.route('**/missing-startup-module.js', (route) => route.abort())
            let releaseConfig!: () => void
            const configReady = new Promise<void>((resolve) => {
                releaseConfig = resolve
            })
            const configPattern = /\/array\/[^/]+\/config(\?|$)/
            await page.route(configPattern, async (route) => {
                await configReady
                await route.fulfill({
                    json: {
                        supportedCompression: [],
                        toolbarParams: {},
                        toolbarVersion: 'toolbar',
                        isAuthenticated: false,
                        siteApps: [],
                        autocaptureExceptions: mode === 'remote-on',
                    },
                })
            })
            await page.exposeFunction('recordStartupEvent', (event) => events.addEvent(event))
            await page.goto('/')
            try {
                await page.evaluate(
                    async ({ entrypoint, mode }) => {
                        const entryUrl = `/dist/${entrypoint}.js`
                        const { default: ph } = await import(entryUrl)
                        const win = window as WindowWithPostHog
                        win.posthog = ph
                        win.startupErrorsObserved = 0
                        window.onerror = window.onunhandledrejection = () => {
                            win.startupErrorsObserved++
                            return false
                        }
                        let extensionClasses
                        if (entrypoint === 'module.slim') {
                            const extensionUrl = '/dist/extension-bundles.js'
                            const { ErrorTrackingExtensions } = await import(extensionUrl)
                            extensionClasses = ErrorTrackingExtensions
                        }
                        ph.init('public_key', {
                            api_host: location.origin,
                            capture_exceptions: mode === 'local' ? true : undefined,
                            capture_pageview: false,
                            opt_out_useragent_filter: true,
                            request_batching: false,
                            __extensionClasses: extensionClasses,
                            before_send: (event) => {
                                win.recordStartupEvent(event)
                                return event
                            },
                        })
                        const script = document.createElement('script')
                        script.textContent = 'throw new Error("startup error")'
                        document.head.appendChild(script)
                        Promise.reject(new Error('startup rejection'))
                        const missingModuleUrl = '/missing-startup-module.js'
                        void import(missingModuleUrl)
                    },
                    { entrypoint, mode }
                )

                await expect
                    .poll(() => page.evaluate(() => (window as WindowWithPostHog).startupErrorsObserved))
                    .toBe(3)
                await expect.poll(() => events.countByName('$exception')).toBe(mode === 'local' ? 3 : 0)

                const response = page.waitForResponse(configPattern)
                releaseConfig()
                await response
                if (mode === 'remote-off') {
                    await page.waitForFunction(
                        () => !(window as WindowWithPostHog).posthog!.exceptionObserver!.isEnabled
                    )
                    expect(events.countByName('$exception')).toBe(0)
                } else {
                    await expect.poll(() => events.countByName('$exception')).toBe(3)
                    const exceptions = events
                        .filterByName('$exception')
                        .map((event) => event.properties.$exception_list[0])
                    expect(exceptions).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({ type: 'Error', value: 'startup error' }),
                            expect.objectContaining({ type: 'Error', value: 'startup rejection' }),
                            expect.objectContaining({ type: 'TypeError' }),
                        ])
                    )
                    for (const exception of exceptions) {
                        expect(exception.mechanism.handled).toBe(false)
                    }
                }
                expect(exceptionScriptRequests).toEqual([])
            } finally {
                releaseConfig()
            }
        })
    }
}

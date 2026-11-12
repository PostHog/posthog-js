import { test, expect, WindowWithPostHog } from '../../fixtures'

for (const entrypoint of ['module', 'module.slim']) {
    test(`captures startup exceptions with ${entrypoint} before external scripts load`, async ({ page, events }) => {
        const exceptionScriptRequests: string[] = []
        await page.route('**/exception-autocapture.js*', (route) => {
            exceptionScriptRequests.push(route.request().url())
            return route.abort()
        })
        await page.route('**/missing-startup-module.js', (route) => route.abort())
        await page.exposeFunction('recordStartupEvent', (event) => events.addEvent(event))
        await page.goto('/')
        await page.evaluate(async (entrypoint) => {
            const entryUrl = `/dist/${entrypoint}.js`
            const { default: ph } = await import(entryUrl)
            const win = window as WindowWithPostHog
            win.posthog = ph
            let extensionClasses
            if (entrypoint === 'module.slim') {
                const extensionUrl = '/dist/extension-bundles.js'
                const { ErrorTrackingExtensions } = await import(extensionUrl)
                extensionClasses = ErrorTrackingExtensions
            }
            ph.init('public_key', {
                api_host: location.origin,
                capture_exceptions: true,
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
        }, entrypoint)

        await expect.poll(() => events.countByName('$exception')).toBe(3)
        const exceptions = events.filterByName('$exception').map((event) => event.properties.$exception_list[0])
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
        expect(exceptionScriptRequests).toEqual([])
    })
}

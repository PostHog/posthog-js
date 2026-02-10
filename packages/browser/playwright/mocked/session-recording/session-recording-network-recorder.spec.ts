import { test, expect } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import { Page } from '@playwright/test'

test.beforeEach(async ({ context }) => {
    void context.route('https://example.com/', (route) => {
        route.fulfill({
            status: 200,
            json: {
                message: 'This is a JSON response',
            },
            headers: {
                'x-remote-header': 'true',
                // required for the above header to be exposed
                'Access-Control-Expose-Headers': '*',
            },
        })
    })
})
;[true, false].forEach((isBadlyBehavedWrapper) => {
    test.describe(`Session recording - network recorder - fetch wrapper ${
        isBadlyBehavedWrapper ? 'is' : 'is not'
    } badly behaved`, () => {
        // these are pretty flaky and annoying, in the short term lets...
        test.describe.configure({ retries: 6 })

        test.beforeEach(async ({ page, context }) => {
            const wrapInPageContext = async (pg: Page) => {
                // this is page.evaluate and not page.exposeFunction because we need to execute it in the browser context
                // or else window is not available...
                // and we can't pass window.fetch to the node context when using page.exposeFunction
                await pg.evaluate(() => {
                    ;(window as any).wrapFetchForTesting = (badlyBehaved: boolean) => {
                        // eslint-disable-next-line compat/compat
                        const originalFetch = window.fetch
                        ;(window as any).originalFetch = originalFetch

                        // eslint-disable-next-line compat/compat
                        window.fetch = async function (
                            requestOrURL: URL | RequestInfo,
                            init?: RequestInit | undefined
                        ) {
                            // eslint-disable-next-line compat/compat
                            const req = new Request(requestOrURL, init)

                            const hasBody = typeof requestOrURL !== 'string' && 'body' in requestOrURL
                            if (hasBody) {
                                // we read the body to (maybe) exhaust it
                                badlyBehaved ? await requestOrURL.text() : await requestOrURL.clone().text()
                            }

                            const res = badlyBehaved
                                ? await originalFetch(requestOrURL, init)
                                : await originalFetch(req)

                            // we read the body to (maybe) exhaust it
                            badlyBehaved ? await res.text() : await res.clone().text()

                            return res
                        }
                    }
                })
            }

            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/*recorder.js*'],
                action: async () => {
                    await start(
                        {
                            options: {
                                session_recording: {
                                    // not the default but makes for easier test assertions
                                    compress_events: false,
                                },
                            },
                            flagsResponseOverrides: {
                                sessionRecording: {
                                    endpoint: '/ses/',
                                    networkPayloadCapture: { recordBody: true, recordHeaders: true },
                                },
                                capturePerformance: true,
                                autocapture_opt_out: true,
                            },
                            url: '/playground/cypress/index.html',
                            runBeforePostHogInit: wrapInPageContext,
                            runAfterPostHogInit: wrapInPageContext,
                        },
                        page,
                        context
                    )
                },
            })

            // also wrap after posthog is loaded
            await page.evaluate((isBadlyBehaved) => {
                ;(window as any).wrapFetchForTesting({
                    badlyBehaved: isBadlyBehaved,
                })
            }, isBadlyBehavedWrapper)
        })

        test.afterEach(async ({ page }) => {
            await page.evaluate(() => {
                if ((window as any).originalFetch) {
                    window.fetch = (window as any).originalFetch
                }
            })
        })
        ;['fetch', 'xhr'].forEach((networkType) => {
            test('it captures ' + networkType, async ({ page, browserName }) => {
                test.skip(
                    browserName === 'firefox',
                    'We are trying to misbehave in order to test things, but it looks like Firefox does not let us... good firefox'
                )

                await page.waitingForNetworkCausedBy({
                    urlPatternsToWaitFor: ['**/ses/*', 'https://example.com/'],
                    action: async () => {
                        await page.click(`[data-cy-${networkType}-call-button]`)
                    },
                })
                const capturedEvents = await page.capturedEvents()
                const snapshots = capturedEvents.filter((c) => c.event === '$snapshot')

                const capturedRequests: Record<string, any>[] = []
                for (const snapshot of snapshots) {
                    for (const snapshotData of snapshot.properties['$snapshot_data']) {
                        if (snapshotData.type === 6) {
                            for (const req of snapshotData.data.payload.requests) {
                                capturedRequests.push(req)
                            }
                        }
                    }
                }

                const expectedInitiatorType = networkType === 'fetch' ? 'fetch' : 'xmlhttprequest'

                // Verify required network entries exist in the captured requests.
                // We use set-based checks rather than strict ordering because:
                //  - config.js script load may or may not appear (it's not mocked, so the failed load
                //    may or may not show up in Performance Resource Timing entries)
                //  - flags fetch and recorder.js script load happen concurrently, so their order
                //    is non-deterministic
                //  - webkit may or may not capture certain fetches depending on wrapping timing
                const hasEntry = (pattern: RegExp, type: string) =>
                    capturedRequests.some((r) => pattern.test(r.name) && r.initiatorType === type)

                expect(hasEntry(/http:\/\/localhost:\d+\/playground\/cypress\//, 'navigation')).toBe(true)
                expect(hasEntry(/https:\/\/localhost:\d+\/static\/array.js/, 'script')).toBe(true)
                expect(
                    hasEntry(
                        /https:\/\/localhost:\d+\/array\/test%20token\/config\?ip=0&_=\d+&ver=1\.\d\d\d\.\d+/,
                        'fetch'
                    )
                ).toBe(true)
                expect(
                    hasEntry(/https:\/\/localhost:\d+\/static\/(lazy-)?recorder.js\?v=1\.\d\d\d\.\d+/, 'script')
                ).toBe(true)
                expect(hasEntry(/https:\/\/example.com/, expectedInitiatorType)).toBe(true)

                if (browserName !== 'webkit') {
                    expect(
                        hasEntry(
                            /https:\/\/localhost:\d+\/flags\/\?v=2&ip=0&_=\d+&ver=1\.\d\d\d\.\d+&compression=base64/,
                            'fetch'
                        )
                    ).toBe(true)
                }

                // the HTML file that cypress is operating on (playground/cypress/index.html)
                // when the button for this test is click makes a post to https://example.com
                const capturedFetchRequest = capturedRequests.find((cr) => cr.name === 'https://example.com/')
                expect(capturedFetchRequest).toBeDefined()

                // proxy for including network timing info
                expect(capturedFetchRequest!.fetchStart).toBeGreaterThan(0)

                expect(capturedFetchRequest!.initiatorType).toEqual(expectedInitiatorType)
                expect(capturedFetchRequest!.isInitial).toBeUndefined()
                expect(capturedFetchRequest!.requestBody).toEqual(`i am the ${networkType} body`)

                expect(capturedFetchRequest!.responseBody).toEqual(
                    JSON.stringify({
                        message: 'This is a JSON response',
                    })
                )

                expect(capturedFetchRequest!.responseHeaders['x-remote-header']).toEqual('true')
            })
        })
    })
})

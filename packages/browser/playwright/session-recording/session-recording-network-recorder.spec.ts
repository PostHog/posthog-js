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
                urlPatternsToWaitFor: ['**/recorder.js*'],
                action: async () => {
                    await start(
                        {
                            options: {
                                session_recording: {},
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
                const expectedCaptureds: [RegExp, string][] =
                    browserName === 'webkit'
                        ? [
                              [/http:\/\/localhost:\d+\/playground\/cypress\//, 'navigation'],
                              [/https:\/\/localhost:\d+\/static\/array.js/, 'script'],
                              // webkit isn't capturing this failed request in the pre-wrapped fetch performance observer records
                              // [/https:\/\/localhost:\d+\/array\/test%20token\/config.js/, 'script'],
                              [
                                  /https:\/\/localhost:\d+\/flags\/\?v=2&config=true&ip=0&_=\d+&ver=1\.\d\d\d\.\d+&compression=base64/,
                                  'fetch',
                              ],
                              // webkit isn't capturing this failed request in the pre-wrapped fetch performance observer records
                              // [/https:\/\/localhost:\d+\/array\/test%20token\/config\?ip=0&_=\d+&ver=1\.\d\d\d\.\d+/, 'fetch'],
                              [/https:\/\/localhost:\d+\/static\/recorder.js\?v=1\.\d\d\d\.\d+/, 'script'],
                              [/https:\/\/example.com/, expectedInitiatorType],
                              // webkit is duplicating this, it is picked up in the initial performance observer records
                              // and in the post-wrapped fetch records
                              // other than having `isInitial: true` on the previous one
                              // and a few milliseconds difference in timestamp on the previous one,
                              // they are identical but processed separately during capture
                              // so need to be de-duplicated during playback
                              [/http:\/\/localhost:\d+\/playground\/cypress\//, 'navigation'],
                          ]
                        : [
                              // firefox doesn't expose the file path presumably for security reasons
                              [/http:\/\/localhost:\d+\/playground\/cypress\//, 'navigation'],
                              [/https:\/\/localhost:\d+\/static\/array.js/, 'script'],
                              [/https:\/\/localhost:\d+\/array\/test%20token\/config.js/, 'script'],
                              [
                                  /https:\/\/localhost:\d+\/flags\/\?v=2&config=true&ip=0&_=\d+&ver=1\.\d\d\d\.\d+&compression=base64/,
                                  'fetch',
                              ],
                              [
                                  /https:\/\/localhost:\d+\/array\/test%20token\/config\?ip=0&_=\d+&ver=1\.\d\d\d\.\d+/,
                                  'fetch',
                              ],
                              [/https:\/\/localhost:\d+\/static\/recorder.js\?v=1\.\d\d\d\.\d+/, 'script'],
                              [/https:\/\/example.com/, expectedInitiatorType],
                          ]

                // yay, includes expected network data
                expect(capturedRequests.length).toEqual(expectedCaptureds.length)
                expectedCaptureds.forEach(([url, initiatorType], index) => {
                    expect(capturedRequests[index].name).toMatch(url)
                    expect(capturedRequests[index].initiatorType).toEqual(initiatorType)
                })

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

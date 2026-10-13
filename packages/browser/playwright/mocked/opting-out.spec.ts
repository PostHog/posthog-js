import { expect, test, WindowWithPostHog } from './utils/posthog-playwright-test-base'
import { start, gotoPage } from './utils/setup'

test.describe('opting out', () => {
    test.describe('when not initialized', () => {
        test('does not capture events without init', async ({ page, context }) => {
            const requests: string[] = []
            page.on('request', (request) => {
                if (/\/e\//.test(request.url())) requests.push(request.url())
            })
            await gotoPage(page, '/playground/cypress/index.html')
            await page.type('[data-cy-input]', 'hello posthog!')
            await page.locator('[data-cy-custom-event-button]').click()
            await page.waitForTimeout(3500)
            expect(requests).toEqual([])
            await start({}, page, context)
            await page.locator('[data-cy-custom-event-button]').click()
            await expect.poll(() => requests.length).toBeGreaterThan(0)
        })
    })

    test.describe('when starting disabled in some way', () => {
        for (const cookieless_mode of [undefined, 'on_reject'] as const) {
            test(`keeps the shared identity when consenting on a new subdomain with ${cookieless_mode ?? 'default'} mode`, async ({
                page,
                context,
            }) => {
                await context.route(/^https:\/\/(www|app)\.example\.com\/$/, (route) =>
                    route.fulfill({ path: './playground/cypress/index.html', contentType: 'text/html' })
                )
                const options = {
                    debug: false,
                    defaults: '2026-01-30' as const,
                    cookieless_mode,
                    opt_out_capturing_by_default: !cookieless_mode,
                    opt_out_persistence_by_default: !cookieless_mode,
                    opt_out_capturing_persistence_type: 'localStorage' as const,
                    cross_subdomain_cookie: true,
                    capture_pageview: false,
                    autocapture: false,
                    disable_session_recording: true,
                }
                await start({ options, waitForFlags: false, url: 'https://www.example.com/' }, page, context)
                await page.waitForFunction(() => (window as WindowWithPostHog).posthog?.__loaded)
                const originalIdentity = await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog!
                    ph.opt_in_capturing()
                    return { distinct_id: ph.get_distinct_id(), $device_id: ph.get_property('$device_id') }
                })
                expect(await context.cookies()).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ domain: '.example.com', name: 'ph_test token_posthog' }),
                    ])
                )

                await start({ options, waitForFlags: false, url: 'https://app.example.com/' }, page, context)
                await page.waitForFunction(() => (window as WindowWithPostHog).posthog?.__loaded)
                expect(
                    await page.evaluate(() => ({
                        consent: (window as WindowWithPostHog).posthog!.get_explicit_consent_status(),
                        local: Object.keys(localStorage).filter((key) => key.startsWith('ph_')),
                        session: Object.keys(sessionStorage).filter((key) => key.startsWith('ph_')),
                    }))
                ).toEqual({ consent: 'pending', local: [], session: [] })
                await page.expectCapturedEventsToBe([])

                const nextIdentity = await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog!
                    ph.opt_in_capturing()
                    return { distinct_id: ph.get_distinct_id(), $device_id: ph.get_property('$device_id') }
                })
                expect(nextIdentity).toEqual(originalIdentity)
                const sharedCookie = (await context.cookies()).find(
                    (cookie) => cookie.name === 'ph_test token_posthog' && cookie.domain === '.example.com'
                )!
                expect(JSON.parse(decodeURIComponent(sharedCookie.value))).toMatchObject(originalIdentity)
                expect(await page.capturedEvents()).toEqual([
                    expect.objectContaining({
                        event: '$opt_in',
                        properties: expect.objectContaining(originalIdentity),
                    }),
                ])
            })
        }

        for (const startsOptedIn of [false, true]) {
            test(`clears restored identity when another tab rejects ${startsOptedIn ? 'granted' : 'pending'} consent`, async ({
                page,
                context,
            }) => {
                await context.route(/^https:\/\/(www|app)\.example\.com\/$/, (route) =>
                    route.fulfill({ path: './playground/cypress/index.html', contentType: 'text/html' })
                )
                const options = {
                    defaults: '2026-01-30' as const,
                    cookieless_mode: 'on_reject' as const,
                    opt_out_capturing_persistence_type: 'localStorage' as const,
                    cross_subdomain_cookie: true,
                    capture_pageview: false,
                    autocapture: false,
                    disable_session_recording: true,
                    request_batching: false,
                    disable_compression: true,
                    debug: false,
                }
                await start({ options, waitForFlags: false, url: 'https://www.example.com/' }, page, context)
                await page.waitForFunction(() => (window as WindowWithPostHog).posthog?.__loaded)
                await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog!
                    ph.opt_in_capturing({ captureEventName: false })
                    ph.identify('shared-user')
                })

                await start({ options, waitForFlags: false, url: 'https://app.example.com/' }, page, context)
                await page.waitForFunction(() => (window as WindowWithPostHog).posthog?.__loaded)
                expect(await page.evaluate(() => (window as WindowWithPostHog).posthog!.get_distinct_id())).toBe(
                    'shared-user'
                )
                if (startsOptedIn) {
                    await page.evaluate(() =>
                        (window as WindowWithPostHog).posthog!.opt_in_capturing({ captureEventName: false })
                    )
                }
                const otherTab = await context.newPage()
                await start({ options, waitForFlags: false, url: 'https://app.example.com/' }, otherTab, context)
                await otherTab.waitForFunction(() => (window as WindowWithPostHog).posthog?.__loaded)
                await otherTab.evaluate(() => (window as WindowWithPostHog).posthog!.opt_out_capturing())

                const outgoing = page.waitForRequest('**/e/*')
                await page.evaluate(() => (window as WindowWithPostHog).posthog!.capture('after-other-tab-rejects'))
                const request = await outgoing
                const properties = request.postDataJSON().batch[0].properties
                expect(properties).toMatchObject({
                    distinct_id: '$posthog_cookieless',
                    $device_id: null,
                    $cookieless_mode: true,
                    $is_identified: false,
                })
                expect(properties.$user_id).toBeUndefined()
                expect(properties.$session_id).toBeUndefined()
                expect(properties.$window_id).toBeUndefined()
                expect(
                    await page.evaluate(() => (window as WindowWithPostHog).posthog!.get_explicit_consent_status())
                ).toBe('denied')
                await otherTab.close()
            })
        }

        test('does not capture events when config opts out by default', async ({ page, context }) => {
            await start(
                {
                    flagsResponseOverrides: {
                        autocapture_opt_out: true,
                    },
                    options: {
                        opt_out_capturing_by_default: true,
                    },
                    url: '/playground/cypress/index.html',
                },
                page,
                context
            )

            await page.expectCapturedEventsToBe([])

            await page.type('[data-cy-input]', 'hello posthog!')
            await page.evaluate(() => (window as WindowWithPostHog).posthog!.capture('consent-control'))
            await page.expectCapturedEventsToBe([])
            await page.evaluate(() => {
                const ph = (window as WindowWithPostHog).posthog!
                ph.opt_in_capturing()
                ph.capture('consent-control')
            })
            expect((await page.capturedEvents()).filter((event) => event.event === 'consent-control')).toHaveLength(1)
        })

        test('sends a $pageview event when opting in', async ({ page, context }) => {
            await start(
                {
                    flagsResponseOverrides: {
                        autocapture_opt_out: true,
                    },
                    options: {
                        opt_out_capturing_by_default: true,
                    },
                    url: '/playground/cypress/index.html',
                },
                page,
                context
            )

            await page.expectCapturedEventsToBe([])

            await page.evaluate(() => {
                ;(window as WindowWithPostHog).posthog?.opt_in_capturing()
            })

            await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])
        })

        test('does not send a duplicate $pageview event when opting in', async ({ page, context }) => {
            await start(
                {
                    flagsResponseOverrides: {
                        autocapture_opt_out: true,
                    },
                    options: {
                        // start opted in!
                        opt_out_capturing_by_default: false,
                    },
                    url: '/playground/cypress/index.html',
                },
                page,
                context
            )

            await page.expectCapturedEventsToBe(['$pageview'])

            await page.evaluate(() => {
                ;(window as WindowWithPostHog).posthog?.opt_in_capturing()
            })

            await page.expectCapturedEventsToBe(['$pageview', '$opt_in'])
        })
    })

    test.describe('user opts out after start', () => {
        test('does not send any events after that', async ({ page, context }) => {
            await start(
                {
                    flagsResponseOverrides: {
                        autocapture_opt_out: false,
                    },
                    url: '/playground/cypress/index.html',
                },
                page,
                context
            )

            await page.expectCapturedEventsToBe(['$pageview'])

            await page.click('[data-cy-custom-event-button]')

            await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])

            await page.evaluate(() => {
                ;(window as WindowWithPostHog).posthog?.opt_out_capturing()
            })

            await page.click('[data-cy-custom-event-button]')

            // no new events
            await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])
        })
    })
})

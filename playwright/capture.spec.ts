import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { pollUntilEventCaptured } from './utils/event-capture-utils'
import { Request } from '@playwright/test'
import { getBase64EncodedPayloadFromBody } from '../cypress/support/compression'
import { PostHog } from '../src/posthog-core'

const startOptions = {
    options: {},
    decideResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
    },
    url: './playground/cypress/index.html',
}

test.describe('event capture', () => {
    test('captures pageviews, autocapture, and custom events', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.click('[data-cy-custom-event-button]')
        await pollUntilEventCaptured(page, 'custom-event')
        await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])

        await start({ ...startOptions, type: 'reload' }, page, context)
        await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event', '$pageleave', '$pageview'])
    })

    test('captures $feature_flag_called event', async ({ page, context }) => {
        await start(startOptions, page, context)
        await page.click('[data-cy-feature-flag-button]')
        await pollUntilEventCaptured(page, '$feature_flag_called')
        const featureFlagCalledEvent = await page
            .capturedEvents()
            .then((events) => events.find((e) => e.event === '$feature_flag_called'))
        expect(featureFlagCalledEvent).toBeTruthy()
        expect(featureFlagCalledEvent?.properties.$feature_flag_bootstrapped_response).toBeNull()
        expect(featureFlagCalledEvent?.properties.$feature_flag_bootstrapped_payload).toBeNull()
        expect(featureFlagCalledEvent?.properties.$used_bootstrap_value).toEqual(false)
    })

    test('captures $feature_flag_called with bootstrapped value properties', async ({ page, context }) => {
        await start(
            {
                ...startOptions,
                options: {
                    ...startOptions.options,
                    bootstrap: {
                        featureFlags: {
                            'some-feature': 'some-value',
                        },
                        featureFlagPayloads: {
                            'some-feature': 'some-payload',
                        },
                    },
                    advanced_disable_feature_flags: true,
                },
                waitForDecide: false,
            },
            page,
            context
        )

        await page.locator('[data-cy-feature-flag-button]').click()
        await pollUntilEventCaptured(page, '$feature_flag_called')
        const featureFlagCalledEvent = await page
            .capturedEvents()
            .then((events) => events.find((e) => e.event === '$feature_flag_called'))
        expect(featureFlagCalledEvent).toBeTruthy()
        expect(featureFlagCalledEvent?.properties.$feature_flag_bootstrapped_response).toEqual('some-value')
        expect(featureFlagCalledEvent?.properties.$feature_flag_bootstrapped_payload).toEqual('some-payload')
        expect(featureFlagCalledEvent?.properties.$used_bootstrap_value).toEqual(true)
    })

    test('captures rage clicks', async ({ page, context }) => {
        await start(
            {
                ...startOptions,
                options: {
                    ...startOptions.options,
                    rageclick: true,
                },
            },
            page,
            context
        )
        await page.locator('body').click({ position: { x: 100, y: 100 } })
        await page.locator('body').click({ position: { x: 98, y: 102 } })
        await page.locator('body').click({ position: { x: 101, y: 103 } })

        await pollUntilEventCaptured(page, '$rageclick')
    })

    test('does not capture rage clicks when autocapture is disabled', async ({ page, context }) => {
        await start(
            {
                ...startOptions,
                options: {
                    ...startOptions.options,
                    rageclick: true,
                    autocapture: false,
                },
            },
            page,
            context
        )
        await page.locator('body').click({ position: { x: 100, y: 100 } })
        await page.locator('body').click({ position: { x: 98, y: 102 } })
        await page.locator('body').click({ position: { x: 101, y: 103 } })

        // no rageclick event to wait for so just wait a little
        await page.waitForTimeout(250)
        await page.expectCapturedEventsToBe(['$pageview'])
    })

    test('captures pageviews and custom events when autocapture disabled', async ({ page, context }) => {
        await start(
            {
                ...startOptions,
                options: {
                    ...startOptions.options,
                    autocapture: false,
                },
            },
            page,
            context
        )

        await page.click('[data-cy-custom-event-button]')
        await pollUntilEventCaptured(page, 'custom-event')
        await page.expectCapturedEventsToBe(['$pageview', 'custom-event'])
    })

    test('captures autocapture, custom events, when pageviews is disabled', async ({ page, context }) => {
        await start(
            {
                ...startOptions,
                options: {
                    ...startOptions.options,
                    capture_pageview: false,
                },
            },
            page,
            context
        )

        await page.click('[data-cy-custom-event-button]')
        await pollUntilEventCaptured(page, 'custom-event')
        await page.expectCapturedEventsToBe(['$autocapture', 'custom-event'])
    })

    test('can capture custom events when auto events is disabled', async ({ page, context }) => {
        await start(
            {
                ...startOptions,
                options: {
                    ...startOptions.options,
                    capture_pageview: false,
                    autocapture: false,
                },
            },
            page,
            context
        )

        await page.click('[data-cy-custom-event-button]')
        await pollUntilEventCaptured(page, 'custom-event')
        await page.expectCapturedEventsToBe(['custom-event'])
    })

    test('makes decide request on start', async ({ page, context }) => {
        // we want to grab any requests to decide so we can inspect their payloads
        const decideRequests: Request[] = []

        page.on('request', (request) => {
            if (request.url().includes('/decide/')) {
                decideRequests.push(request)
            }
        })

        await start(
            {
                ...startOptions,
                options: {
                    ...startOptions.options,
                },
                runBeforePostHogInit: async (page) => {
                    // it's tricky to pass functions as args the way posthog config is passed in playwright
                    // so here we set the function on the window object
                    // and then call it in the loaded function during init
                    await page.evaluate(() => {
                        ;(window as any).__ph_loaded = (ph: PostHog) => {
                            ph.identify('new-id')
                            ph.group('company', 'id:5', { id: 5, company_name: 'Awesome Inc' })
                            ph.group('playlist', 'id:77', { length: 8 })
                        }
                    })
                },
            },
            page,
            context
        )

        expect(decideRequests.length).toBe(1)
        const decideRequest = decideRequests[0]
        const decidePayload = getBase64EncodedPayloadFromBody(decideRequest.postData())
        expect(decidePayload).toEqual({
            token: 'test token',
            distinct_id: 'new-id',
            person_properties: {},
            $anon_distinct_id: decidePayload.$anon_distinct_id,
            groups: {
                company: 'id:5',
                playlist: 'id:77',
            },
            group_properties: {
                company: { id: 5, company_name: 'Awesome Inc' },
                playlist: { length: 8 },
            },
        })
    })

    test('does a single decide call on following changes', async ({ page, context }) => {
        // we want to grab any requests to decide so we can inspect their payloads
        const decideRequests: Request[] = []

        page.on('request', (request) => {
            if (request.url().includes('/decide/')) {
                decideRequests.push(request)
            }
        })

        await start(
            {
                ...startOptions,
                options: {
                    ...startOptions.options,
                },
                runBeforePostHogInit: async (page) => {
                    // it's tricky to pass functions as args the way posthog config is passed in playwright
                    // so here we set the function on the window object
                    // and then call it in the loaded function during init
                    await page.evaluate(() => {
                        ;(window as any).__ph_loaded = (ph: PostHog) => {
                            ph.identify('new-id')
                            ph.group('company', 'id:5', { id: 5, company_name: 'Awesome Inc' })
                            ph.group('playlist', 'id:77', { length: 8 })
                        }
                    })
                },
            },
            page,
            context
        )

        expect(decideRequests.length).toBe(1)

        await page.waitingForNetworkCausedBy(['**/decide/**'], async () => {
            await page.evaluate(() => {
                const ph = (window as any).posthog
                ph.group('company', 'id:6')
                ph.group('playlist', 'id:77')
                ph.group('anothergroup', 'id:99')
            })
        })

        expect(decideRequests.length).toBe(2)
    })

    test.describe('autocapture config', () => {
        test('do not capture click if not in allowlist', async ({ page, context }) => {
            await start(
                {
                    ...startOptions,
                    options: {
                        ...startOptions.options,
                        capture_pageview: false,
                        autocapture: {
                            dom_event_allowlist: ['change'],
                        },
                    },
                },
                page,
                context
            )

            await page.locator('[data-cy-custom-event-button]').click()
            // no autocapture event from click
            await page.expectCapturedEventsToBe(['custom-event'])

            await page.locator('[data-cy-input]').fill('hello posthog!')
            // blur the input
            await page.locator('body').click()
            await page.expectCapturedEventsToBe(['custom-event', '$autocapture'])
        })

        test('capture clicks when configured to', async ({ page, context }) => {
            await start(
                {
                    ...startOptions,
                    options: { ...startOptions.options, autocapture: { dom_event_allowlist: ['click'] } },
                },
                page,
                context
            )

            await page.locator('[data-cy-custom-event-button]').click()
            await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])

            await page.locator('[data-cy-input]').fill('hello posthog!')
            // blur the input
            await page.locator('body').click()
            // no change autocapture event
            await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])
        })

        test('obeys url allowlist', async ({ page, context }) => {
            await start(
                {
                    ...startOptions,
                    options: { ...startOptions.options, autocapture: { url_allowlist: ['.*test-is-not-on-this.*'] } },
                },
                page,
                context
            )

            await page.locator('[data-cy-custom-event-button]').click()
            await page.expectCapturedEventsToBe(['$pageview', 'custom-event'])

            await page.resetCapturedEvents()
            await start(
                {
                    ...startOptions,
                    options: { ...startOptions.options, autocapture: { url_allowlist: ['.*cypress.*'] } },
                },
                page,
                context
            )

            await page.locator('[data-cy-custom-event-button]').click()
            await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])
        })

        test('obeys element allowlist', async ({ page, context }) => {
            await start(
                {
                    ...startOptions,
                    options: { ...startOptions.options, autocapture: { element_allowlist: ['button'] } },
                },
                page,
                context
            )

            await page.locator('[data-cy-custom-event-button]').click()
            await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])

            await page.resetCapturedEvents()
            await start(
                {
                    ...startOptions,
                    options: { ...startOptions.options, autocapture: { element_allowlist: ['input'] } },
                },
                page,
                context
            )

            await page.locator('[data-cy-custom-event-button]').click()
            await page.expectCapturedEventsToBe(['$pageview', 'custom-event'])
        })

        test('obeys css selector allowlist', async ({ page, context }) => {
            await start(
                {
                    ...startOptions,
                    options: {
                        ...startOptions.options,
                        autocapture: { css_selector_allowlist: ['[data-cy-custom-event-button]'] },
                    },
                },
                page,
                context
            )

            await page.locator('[data-cy-custom-event-button]').click()
            await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])

            await page.resetCapturedEvents()
            await start(
                {
                    ...startOptions,
                    options: { ...startOptions.options, autocapture: { css_selector_allowlist: ['[data-cy-input]'] } },
                },
                page,
                context
            )

            await page.locator('[data-cy-custom-event-button]').click()
            await page.expectCapturedEventsToBe(['$pageview', 'custom-event'])
        })
    })
})

import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { pollUntilEventCaptured } from './utils/event-capture-utils'
import { Request } from '@playwright/test'
import { decompressSync, strFromU8 } from 'fflate'

function getGzipEncodedPayloady(req: Request): Record<string, any> {
    const data = req.postDataBuffer()
    if (!data) {
        //console.log('wat', req.postData())
        throw new Error('Expected body to be present')
    }
    const decoded = strFromU8(decompressSync(data))

    return JSON.parse(decoded)
}

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

    test('contains the correct payload after an event', async ({ page, context }) => {
        const captureRequests: Request[] = []

        page.on('request', (request) => {
            if (request.url().includes('/e/')) {
                captureRequests.push(request)
            }
        })

        await start({}, page, context)

        // Pageview will be sent immediately
        await pollUntilEventCaptured(page, '$pageview')
        expect(captureRequests.length).toEqual(1)
        const captureRequest = captureRequests[0]
        expect(captureRequest.headers()['content-type']).toEqual('text/plain')
        expect(captureRequest.url()).toMatch(/gzip/)
        const payload = getGzipEncodedPayloady(captureRequest)
        expect(payload.event).toEqual('$pageview')
        expect(Object.keys(payload.properties).length).toBeGreaterThan(0)
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
})

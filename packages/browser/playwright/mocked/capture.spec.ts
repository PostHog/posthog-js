import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { pollUntilCondition, pollUntilEventCaptured } from './utils/event-capture-utils'
import { Request } from '@playwright/test'
import { decompressSync, strFromU8 } from 'fflate'

function getGzipEncodedPayloady(req: Request): Record<string, any> {
    const data = req.postDataBuffer()
    if (!data) {
        throw new Error('Expected body to be present')
    }
    const decoded = strFromU8(decompressSync(data))

    return JSON.parse(decoded)
}

const startOptions = {
    options: {},
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
    },
    url: '/playground/cypress/index.html',
}

test.describe('event capture', () => {
    test('captures pageviews, autocapture, and custom events', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.click('[data-cy-custom-event-button]')
        await pollUntilEventCaptured(page, 'custom-event')
        await page.expectCapturedEventsToBe(['$pageview', '$autocapture', 'custom-event'])

        await start({ ...startOptions, type: 'reload' }, page, context)
        // we can't capture $pageleave because we're storing it on the page and reloading wipes that :/
        // TODO is there a way to catch and store between page loads
        await page.expectCapturedEventsToBe(['$pageview'])
    })

    test('contains the correct payload after an event', async ({ page, context, browserName }) => {
        const captureRequests: Request[] = []

        page.on('request', (request) => {
            if (request.url().includes('/e/') && request.method() === 'POST') {
                captureRequests.push(request)
            }
        })

        await start({}, page, context)

        // Pageview will be sent immediately
        await pollUntilEventCaptured(page, '$pageview')
        await pollUntilCondition(page, () => captureRequests.length > 0)
        expect(captureRequests.length).toEqual(1)
        const captureRequest = captureRequests[0]
        expect(captureRequest.headers()['content-type']).toEqual('text/plain')
        expect(captureRequest.url()).toMatch(/gzip/)
        // webkit doesn't allow us to read the body for some reason
        // see e.g. https://github.com/microsoft/playwright/issues/6479
        if (browserName !== 'webkit') {
            const payload = getGzipEncodedPayloady(captureRequest)
            expect(payload.event).toEqual('$pageview')
            expect(Object.keys(payload.properties).length).toBeGreaterThan(0)
        }
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
                waitForFlags: false,
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

        const button = page.locator('[data-cy-custom-event-button]')
        await button.click()
        await button.click()
        await button.click()

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

        const button = page.locator('[data-cy-custom-event-button]')
        await button.click()
        await button.click()
        await button.click()

        // no rageclick event to wait for so just wait a little
        await page.waitForTimeout(250)
        await page.expectCapturedEventsToBe(['$pageview', 'custom-event', 'custom-event', 'custom-event'])
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

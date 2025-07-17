import { expect, test } from './fixtures'
import { Request } from '@playwright/test'
import { decompressSync, strFromU8 } from 'fflate'

function getGzipEncodedPayloady(req: Request): Record<string, any> {
    const data = req.postDataBuffer()
    if (!data) {
        throw new Error('Expected body to be present')
    }
    const decoded = strFromU8(decompressSync(data as any))

    return JSON.parse(decoded)
}

const startOptions = {
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
    },
    url: '/playground/cypress/index.html',
}

test.describe('event capture', () => {
    test.use(startOptions)

    test('captures pageviews, autocapture, and custom events', async ({ page, events, posthog }) => {
        await posthog.init()
        await events.waitForEvent('$pageview')
        await page.click('[data-cy-custom-event-button]')
        await page.reloadIdle()
        events.expectMatchList(['$pageview', '$autocapture', 'custom-event', '$pageleave'])
        events.clear()
        await posthog.init()
        await events.waitForEvent('$pageview')
        events.expectMatchList(['$pageview'])
    })

    test('contains the correct payload after an event', async ({ page, posthog, browserName, events }) => {
        const captureRequests: Request[] = []

        page.on('request', (request) => {
            if (request.url().includes('/e/') && request.method() === 'POST') {
                captureRequests.push(request)
            }
        })
        await posthog.init()

        // Pageview will be sent immediately
        await events.waitForEvent('$pageview')
        await page.waitForCondition(() => captureRequests.length > 0)
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

    test('captures $feature_flag_called event', async ({ page, posthog, events }) => {
        await posthog.init()
        await page.click('[data-cy-feature-flag-button]')
        await events.waitForEvent('$feature_flag_called')
        const featureFlagCalledEvent = events.find((e) => e.event === '$feature_flag_called')
        expect(featureFlagCalledEvent).toBeTruthy()
        expect(featureFlagCalledEvent?.properties.$feature_flag_bootstrapped_response).toBeNull()
        expect(featureFlagCalledEvent?.properties.$feature_flag_bootstrapped_payload).toBeNull()
        expect(featureFlagCalledEvent?.properties.$used_bootstrap_value).toEqual(false)
    })

    test('captures $feature_flag_called with bootstrapped value properties', async ({ page, posthog, events }) => {
        await posthog.init({
            bootstrap: {
                featureFlags: {
                    'some-feature': 'some-value',
                },
                featureFlagPayloads: {
                    'some-feature': 'some-payload',
                },
            },
            advanced_disable_feature_flags: true,
        })

        await page.locator('[data-cy-feature-flag-button]').click()
        await events.waitForEvent('$feature_flag_called')
        const featureFlagCalledEvent = events.find((e) => e.event === '$feature_flag_called')
        expect(featureFlagCalledEvent).toBeTruthy()
        expect(featureFlagCalledEvent?.properties.$feature_flag_bootstrapped_response).toEqual('some-value')
        expect(featureFlagCalledEvent?.properties.$feature_flag_bootstrapped_payload).toEqual('some-payload')
        expect(featureFlagCalledEvent?.properties.$used_bootstrap_value).toEqual(true)
    })

    test('captures rage clicks', async ({ page, events, posthog }) => {
        await posthog.init({
            rageclick: true,
        })

        const button = page.locator('[data-cy-custom-event-button]')
        await button.click()
        await button.click()
        await button.click()

        await events.waitForEvent('$rageclick')
    })

    test('does not capture rage clicks when autocapture is disabled', async ({ page, posthog, events }) => {
        await posthog.init({
            rageclick: true,
            autocapture: false,
        })
        await events.waitForEvent('$pageview')

        const button = page.locator('[data-cy-custom-event-button]')
        await button.click()
        await button.click()
        await button.click()

        // no rageclick event to wait for so just wait a little
        await page.waitForTimeout(250)
        events.expectMatchList(['$pageview', 'custom-event', 'custom-event', 'custom-event'])
    })

    test('captures pageviews and custom events when autocapture disabled', async ({ page, posthog, events }) => {
        await posthog.init({
            autocapture: false,
        })
        await events.waitForEvent('$pageview')
        await page.click('[data-cy-custom-event-button]')
        events.expectMatchList(['$pageview', 'custom-event'])
    })

    test('captures autocapture, custom events, when pageviews is disabled', async ({ page, posthog, events }) => {
        await posthog.init({
            capture_pageview: false,
        })
        await page.click('[data-cy-custom-event-button]')
        events.expectMatchList(['$autocapture', 'custom-event'])
    })

    test('can capture custom events when auto events is disabled', async ({ page, posthog, events }) => {
        await posthog.init({
            capture_pageview: false,
            autocapture: false,
        })
        await page.click('[data-cy-custom-event-button]')
        events.expectMatchList(['custom-event'])
    })
})

import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { pollUntilCondition, pollUntilEventCaptured } from './utils/event-capture-utils'
import { Page, Request } from '@playwright/test'
import { satisfies } from 'compare-versions'
import { decompressSync, strFromU8 } from 'fflate'

function getGzipEncodedPayloady(req: Request): Record<string, any> {
    const data = req.postDataBuffer()
    if (!data) {
        throw new Error('Expected body to be present')
    }
    expect(data[0]).toBe(0x1f)
    expect(data[1]).toBe(0x8b)
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
        const captureRequestUrl = new URL(captureRequest.url())
        expect(captureRequestUrl.searchParams.has('compression')).toBe(false)
        expect(captureRequest.url()).not.toContain('gzip')
        // webkit doesn't allow us to read the body for some reason
        // see e.g. https://github.com/microsoft/playwright/issues/6479
        if (browserName !== 'webkit') {
            const payload = getGzipEncodedPayloady(captureRequest)
            // Batched capture request envelopes were introduced in posthog-js 1.407.3.
            const usesLegacyCapturePayload =
                process.env.COMPAT_VERSION !== undefined && satisfies(process.env.COMPAT_VERSION, '<1.407.3')

            if (usesLegacyCapturePayload) {
                expect(payload.event).toEqual('$pageview')
                expect(payload.properties.token).toEqual('test token')
                expect(Object.keys(payload.properties).length).toBeGreaterThan(0)
            } else {
                expect(payload.api_key).toEqual('test token')
                expect(payload.sent_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
                expect(payload.batch).toHaveLength(1)
                expect(payload.batch[0].event).toEqual('$pageview')
                expect(Object.keys(payload.batch[0].properties).length).toBeGreaterThan(0)
            }
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

    test.describe('rageclick content ignorelist on a non-semantic cursor:pointer control', () => {
        async function injectPointerControl(page: Page, ariaLabel: string) {
            await page.evaluate((label) => {
                const control = document.createElement('div')
                control.id = 'rc-next'
                control.style.cursor = 'pointer'
                control.setAttribute('aria-label', label)

                const icon = document.createElement('i')
                icon.id = 'rc-icon'
                icon.style.display = 'inline-block'
                icon.style.width = '40px'
                icon.style.height = '40px'

                control.appendChild(icon)
                document.body.appendChild(control)
            }, ariaLabel)
        }

        test('suppresses the rageclick when the wrapper label matches a keyword', async ({ page, context }) => {
            await start(
                {
                    ...startOptions,
                    options: {
                        ...startOptions.options,
                        rageclick: { content_ignorelist: true },
                    },
                },
                page,
                context
            )

            await injectPointerControl(page, 'Next slide')

            // the premise: a real browser inherits `cursor:pointer` onto the icon, unlike jsdom
            const iconCursor = await page.locator('#rc-icon').evaluate((el) => getComputedStyle(el).cursor)
            expect(iconCursor).toEqual('pointer')

            const icon = page.locator('#rc-icon')
            await icon.click()
            await icon.click()
            await icon.click()

            // no rageclick event to wait for so just wait a little
            await page.waitForTimeout(250)
            const capturedEvents = await page.capturedEvents()
            expect(capturedEvents.map((event) => event.event)).not.toContain('$rageclick')
        })

        test('still captures the rageclick when the wrapper label matches no keyword', async ({ page, context }) => {
            await start(
                {
                    ...startOptions,
                    options: {
                        ...startOptions.options,
                        rageclick: { content_ignorelist: true },
                    },
                },
                page,
                context
            )

            await injectPointerControl(page, 'Buy now')

            const icon = page.locator('#rc-icon')
            await icon.click()
            await icon.click()
            await icon.click()

            await pollUntilEventCaptured(page, '$rageclick')
        })
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

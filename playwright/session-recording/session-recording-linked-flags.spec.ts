import { test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import { assertThatRecordingStarted, pollUntilEventCaptured } from '../utils/event-capture-utils'
import { BrowserContext, Page } from '@playwright/test'
import { DecideResponse } from '../../src/types'

const startOptions = {
    options: {
        session_recording: {},
        opt_out_capturing_by_default: true,
    },
    decideResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
            // a flag that doesn't exist, can never be recorded
            linkedFlag: 'i am a flag that does not exist',
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: './playground/cypress/index.html',
}

test.describe('Session recording - linked flags', () => {
    const startWithFlags = async (
        page: Page,
        context: BrowserContext,
        decideResponseOverrides: Partial<DecideResponse>
    ) => {
        await start(
            {
                ...startOptions,
                decideResponseOverrides: {
                    ...startOptions.decideResponseOverrides,
                    ...decideResponseOverrides,
                },
            },
            page,
            context
        )
        await page.expectCapturedEventsToBe([])
        await page.resetCapturedEvents()
    }

    test('does not start when boolean linked flag is false', async ({ page, context }) => {
        await startWithFlags(page, context, {
            sessionRecording: { linkedFlag: 'my-linked-flag' },
            featureFlags: { 'my-linked-flag': false },
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/recorder.js*'],
            action: async () => {
                await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog
                    ph?.opt_in_capturing()
                })
            },
        })

        await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])

        // even activity won't trigger a snapshot, we're buffering
        await page.locator('[data-cy-input]').type('hello posthog!')
        // short delay since there's no snapshot to wait for
        await page.waitForTimeout(250)
        await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])
    })

    test('starts when boolean linked flag is true', async ({ page, context }) => {
        await startWithFlags(page, context, {
            sessionRecording: { linkedFlag: 'my-linked-flag' },
            featureFlags: { 'my-linked-flag': true },
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/recorder.js*'],
            action: async () => {
                await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog
                    ph?.opt_in_capturing()
                })
            },
        })

        await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])
        await page.locator('[data-cy-input]').type('hello posthog!')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })

    test('can opt in and override linked flag', async ({ page, context }) => {
        await startWithFlags(page, context, {
            sessionRecording: { linkedFlag: 'my-linked-flag' },
            featureFlags: { 'not-my-linked-flag': true },
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/recorder.js*'],
            action: async () => {
                await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog
                    ph?.opt_in_capturing()
                    // starting does not begin recording because of the linked flag
                    ph?.startSessionRecording()
                })
            },
        })

        await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])

        await page.resetCapturedEvents()

        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.startSessionRecording({ linked_flag: true })
        })
        await page.locator('[data-cy-input]').type('hello posthog!')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })
})

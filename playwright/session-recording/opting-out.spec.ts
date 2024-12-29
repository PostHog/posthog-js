import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import { BrowserContext, Page } from '@playwright/test'
import { PostHogConfig } from '../../src/types'
import { assertThatRecordingStarted, pollUntilEventCaptured } from '../utils/event-capture-utils'

async function startWith(config: Partial<PostHogConfig>, page: Page, context: BrowserContext) {
    // there will be a decide call
    const decideResponse = page.waitForResponse('**/decide/*')

    await start(
        {
            options: config,
            decideResponseOverrides: {
                sessionRecording: {
                    endpoint: '/ses/',
                    networkPayloadCapture: { recordBody: true, recordHeaders: true },
                },
                capturePerformance: true,
                autocapture_opt_out: true,
            },
            url: './playground/cypress/index.html',
        },
        page,
        context
    )

    // there will be a decide call
    await decideResponse
}

test.describe('Session Recording - opting out', () => {
    test('does not capture events when config opts out by default', async ({ page, context }) => {
        // but no recorder or snapshot call, because we're opting out
        void expect(page.waitForResponse('**/recorder.js*', { timeout: 250 })).rejects.toThrowError('Timeout')
        void expect(page.waitForResponse('**/ses/*', { timeout: 250 })).rejects.toThrowError('Timeout')
        await startWith({ opt_out_capturing_by_default: true }, page, context)

        await page.locator('[data-cy-input]').type('hello posthog!')
        await page.waitForTimeout(250) // short delay since there's no snapshot to wait for
        await page.expectCapturedEventsToBe([])
    })

    test('does not capture recordings when config disables session recording', async ({ page, context }) => {
        // but no recorder or snapshot call, because we're opting out
        void expect(page.waitForResponse('**/recorder.js*', { timeout: 250 })).rejects.toThrowError('Timeout')
        void expect(page.waitForResponse('**/ses/*', { timeout: 250 })).rejects.toThrowError('Timeout')

        await startWith({ disable_session_recording: true }, page, context)

        await page.locator('[data-cy-input]').type('hello posthog!')
        await page.waitForTimeout(250) // short delay since there's no snapshot to wait for
        await page.expectCapturedEventsToBe(['$pageview'])
    })

    test('can start recording after starting opted out', async ({ page, context }) => {
        await startWith({ opt_out_capturing_by_default: true }, page, context)

        await page.waitingForNetworkCausedBy(['**/recorder.js*'], async () => {
            await page.evaluate(() => {
                const ph = (window as WindowWithPostHog).posthog
                ph?.opt_in_capturing()
                ph?.startSessionRecording()
            })
        })

        await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])

        await page.resetCapturedEvents()

        await page.locator('[data-cy-input]').type('hello posthog!')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })

    test('can start recording when starting disabled', async ({ page, context }) => {
        await startWith({ disable_session_recording: true }, page, context)

        await page.waitingForNetworkCausedBy(['**/recorder.js*'], async () => {
            await page.resetCapturedEvents()
            await page.evaluate(() => {
                const ph = (window as WindowWithPostHog).posthog
                ph?.startSessionRecording()
            })
        })

        await page.locator('[data-cy-input]').type('hello posthog!')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })
})

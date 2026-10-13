import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import { trackRecordingRequests } from '../utils/recording-requests'
import { BrowserContext, Page } from '@playwright/test'
import { PostHogConfig } from '@/types'
import { assertThatRecordingStarted, pollUntilEventCaptured } from '../utils/event-capture-utils'

async function startWith(config: Partial<PostHogConfig>, page: Page, context: BrowserContext) {
    // there will be a flags call
    const flagsResponse = page.waitForResponse('**/flags/*')

    await start(
        {
            options: config,
            flagsResponseOverrides: {
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

    // there will be a flags call
    await flagsResponse
}

test.describe('Session Recording - opting out', () => {
    test('does not capture events when config opts out by default', async ({ page, context }) => {
        const recordingRequests = trackRecordingRequests(page)
        await startWith({ opt_out_capturing_by_default: true }, page, context)

        await page.locator('[data-cy-input]').type('hello posthog!')
        await page.waitForTimeout(250) // short delay since there's no snapshot to wait for
        await page.expectCapturedEventsToBe([])
        expect(recordingRequests).toEqual([])
    })

    test('does not capture recordings when config disables session recording', async ({ page, context }) => {
        const recordingRequests = trackRecordingRequests(page)
        await startWith({ disable_session_recording: true }, page, context)

        await page.locator('[data-cy-input]').type('hello posthog!')
        await page.waitForTimeout(250) // short delay since there's no snapshot to wait for
        await page.expectCapturedEventsToBe(['$pageview'])
        expect(recordingRequests).toEqual([])
    })

    test('can start recording after starting opted out', async ({ page, context }) => {
        await startWith({ opt_out_capturing_by_default: true }, page, context)

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog
                    ph?.opt_in_capturing()
                    ph?.startSessionRecording()
                })
            },
        })

        await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])

        await page.resetCapturedEvents()

        await page.locator('[data-cy-input]').type('hello posthog!')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })

    test('can start recording when starting disabled', async ({ page, context }) => {
        await startWith({ disable_session_recording: true }, page, context)

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await page.resetCapturedEvents()
                await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog
                    ph?.startSessionRecording()
                })
            },
        })

        await page.locator('[data-cy-input]').type('hello posthog!')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })

    test('does not capture session recordings when flags is disabled', async ({ page, context }) => {
        const recordingRequests = trackRecordingRequests(page)
        await start(
            { options: { advanced_disable_flags: true, autocapture: false }, waitForFlags: false },
            page,
            context
        )

        await pollUntilEventCaptured(page, '$pageview')
        await page.locator('[data-cy-custom-event-button]').click()
        await page.locator('[data-cy-input]').type('hello posthog!')
        await page.waitForTimeout(200)

        const capturedEvents = await page.capturedEvents()
        // no snapshot events sent
        expect(capturedEvents.map((x) => x.event)).toEqual(['$pageview', 'custom-event'])
        expect(recordingRequests).toEqual([])
    })
})

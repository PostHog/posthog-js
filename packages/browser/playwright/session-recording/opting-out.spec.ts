import { expect, test, WindowWithPostHog } from '../fixtures'

import { PostHogConfig } from '../../src/types'
import { PosthogPage } from '../fixtures/posthog'
import { NetworkPage } from '../fixtures/network'

async function startWith(posthog: PosthogPage, config: Partial<PostHogConfig>, network: NetworkPage) {
    // there will be a flags call
    const flagsResponse = network.waitForFlags()

    await posthog.init(config)

    // there will be a flags call
    await flagsResponse
}

test.describe('Session Recording - opting out', () => {
    test.use({
        flagsOverrides: {
            sessionRecording: {
                endpoint: '/ses/',
                networkPayloadCapture: { recordBody: true, recordHeaders: true },
            },
            capturePerformance: true,
            autocapture_opt_out: true,
        },
        url: './playground/cypress/index.html',
    })

    test('does not capture events when config opts out by default', async ({ page, posthog, network, events }) => {
        // but no recorder or snapshot call, because we're opting out
        void expect(page.waitForResponse('**/recorder.js*', { timeout: 250 })).rejects.toThrowError('Timeout')
        void expect(page.waitForResponse('**/ses/*', { timeout: 250 })).rejects.toThrowError('Timeout')
        await startWith(posthog, { opt_out_capturing_by_default: true }, network)

        await page.locator('[data-cy-input]').pressSequentially('hello posthog!')
        await page.waitForTimeout(250) // short delay since there's no snapshot to wait for
        events.expectMatchList([])
    })

    test('does not capture recordings when config disables session recording', async ({
        page,
        posthog,
        network,
        events,
    }) => {
        // but no recorder or snapshot call, because we're opting out
        void expect(page.waitForResponse('**/recorder.js*', { timeout: 250 })).rejects.toThrowError('Timeout')
        void expect(page.waitForResponse('**/ses/*', { timeout: 250 })).rejects.toThrowError('Timeout')

        await startWith(posthog, { disable_session_recording: true }, network)

        await page.locator('[data-cy-input]').pressSequentially('hello posthog!')
        await page.waitForTimeout(250) // short delay since there's no snapshot to wait for
        events.expectMatchList(['$pageview'])
    })

    test('can start recording after starting opted out', async ({ page, posthog, network, events }) => {
        await startWith(posthog, { opt_out_capturing_by_default: true }, network)

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/recorder.js*'],
            action: async () => {
                await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog
                    ph?.opt_in_capturing()
                    ph?.startSessionRecording()
                })
            },
        })

        events.expectMatchList(['$opt_in', '$pageview'])
        events.clear()

        await page.locator('[data-cy-input]').fill('hello posthog!')
        await events.waitForEvent('$snapshot')
        events.expectRecordingStarted()
    })

    test('can start recording when starting disabled', async ({ page, posthog, network, events }) => {
        await startWith(posthog, { disable_session_recording: true }, network)

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/recorder.js*'],
            action: async () => {
                events.clear()
                await posthog.evaluate((ph) => {
                    ph.startSessionRecording()
                })
            },
        })

        await page.locator('[data-cy-input]').pressSequentially('hello posthog!')
        await events.waitForEvent('$snapshot')
        events.expectRecordingStarted()
    })

    test('does not capture session recordings when flags is disabled', async ({ page, posthog, events }) => {
        await posthog.init({ advanced_disable_flags: true, autocapture: false })
        await events.waitForEvent('$pageview')

        await page.locator('[data-cy-custom-event-button]').click()

        const callsToSessionRecording = page.waitForResponse('**/ses/').catch(() => {
            // when the test ends, waitForResponse will throw an error
            // we're happy not to get a response here so we can swallow it
            return null
        })

        await page.locator('[data-cy-input]').pressSequentially('hello posthog!')

        void callsToSessionRecording.then((response) => {
            if (response) {
                throw new Error('Session recording call was made and should not have been')
            }
        })
        await page.waitForTimeout(200)

        const capturedEvents = events.all()
        // no snapshot events sent
        expect(capturedEvents.map((x) => x.event)).toEqual(['$pageview', 'custom-event'])
    })
})

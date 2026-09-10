import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'
import { BrowserContext, Page } from '@playwright/test'
import { FlagsResponse, PostHogConfig } from '@/types'

async function startWith(
    sessionRecording: FlagsResponse['sessionRecording'],
    options: Partial<PostHogConfig>,
    page: Page,
    context: BrowserContext
) {
    await start(
        {
            options: { session_recording: { compress_events: false }, ...options },
            flagsResponseOverrides: {
                sessionRecording,
                capturePerformance: true,
                autocapture_opt_out: true,
            },
            url: './playground/cypress/index.html',
        },
        page,
        context
    )
}

const reasonOn = async (page: Page, eventName: string) => {
    await page.evaluate((name) => (window as WindowWithPostHog).posthog?.capture(name), eventName)
    const captured = (await page.capturedEvents()).find((e) => e.event === eventName)
    return {
        status: captured?.properties.$recording_status,
        reason: captured?.properties.$sdk_debug_replay_disabled_reason,
    }
}

test.describe('Session recording - disabled reason', () => {
    test('names the disabled reason for the client config switch that stopSessionRecording flips', async ({
        page,
        context,
    }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await startWith({ endpoint: '/ses/' }, {}, page, context)
            },
        })
        await waitForSessionRecordingToStart(page)
        expect(await reasonOn(page, 'while_recording')).toEqual({ status: 'active', reason: undefined })

        await page.evaluate(() => (window as WindowWithPostHog).posthog?.stopSessionRecording())

        // the stopped recorder keeps reporting the status it had, so the reason is the only signal
        expect(await reasonOn(page, 'after_stop')).toEqual({
            status: 'active',
            reason: ['client_config_disabled'],
        })
    })

    test('names the disabled reason for a client config that disables recording from the start', async ({
        page,
        context,
    }) => {
        await startWith({ endpoint: '/ses/' }, { disable_session_recording: true }, page, context)

        expect(await reasonOn(page, 'never_recording')).toEqual({
            status: 'disabled',
            reason: ['client_config_disabled'],
        })
    })

    test('names the disabled reason for a remote disable', async ({ page, context }) => {
        await startWith(false, {}, page, context)

        expect(await reasonOn(page, 'remotely_disabled')).toEqual({
            status: 'disabled',
            reason: ['remote_config_disabled'],
        })
    })

    test('drops the disabled reason once recording starts', async ({ page, context }) => {
        await startWith({ endpoint: '/ses/' }, { disable_session_recording: true }, page, context)
        expect(await reasonOn(page, 'never_started')).toEqual({
            status: 'disabled',
            reason: ['client_config_disabled'],
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await page.evaluate(() => (window as WindowWithPostHog).posthog?.startSessionRecording())
            },
        })
        await waitForSessionRecordingToStart(page)

        expect(await reasonOn(page, 'after_start')).toEqual({ status: 'active', reason: undefined })
    })
})

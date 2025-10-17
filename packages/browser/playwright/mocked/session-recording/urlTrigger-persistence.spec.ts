import { RemoteConfig } from '@/types'
import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

test.describe('Session recording - URL trigger with persistence and eager loading disabled', () => {
    // a regression test because we missed this on first switching to lazy loading
    test('should use persisted remote config on page refresh keeping the pending trigger behaviour', async ({
        page,
        context,
        browserName,
    }) => {
        test.skip(browserName === 'firefox', 'Consistently fails in firefox CI and blocking other PRs 🙈')

        const startOptions = {
            options: {
                session_recording: {
                    // not the default but makes for easier test assertions
                    compress_events: false,
                },
                __preview_eager_load_replay: false,
            },
            url: '/playground/cypress/index.html',
        }

        // Initial page load also has flag overrides
        const initialOptions = {
            ...startOptions,
            resetOnInit: true,
            flagsResponseOverrides: {
                sessionRecording: {
                    endpoint: '/ses/',
                    sampleRate: '1',
                    urlTriggers: [
                        {
                            url: '/non-matching-path',
                            matching: 'regex',
                        },
                    ],
                } satisfies RemoteConfig['sessionRecording'],
                capturePerformance: true,
                autocapture_opt_out: true,
            },
        }

        // Load the page initially with recorder
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(initialOptions, page, context)
            },
        })

        // Verify initial pageview is captured
        await page.expectCapturedEventsToBe(['$pageview'])

        // The remote config should be persisted now with the non-matching URL trigger
        // Let's verify recording is not active since URL doesn't match
        const recordingStatus = await page.evaluate(() => {
            const ph = (window as any).posthog
            return ph?.sessionRecording?.status
        })
        expect(recordingStatus).toBe('buffering')

        await page.resetCapturedEvents()

        await page.evaluate(() => {
            const ph = (window as any).posthog
            ph?.capture('probe for debug properties')
        })
        const beforeReloadProbeEvent = (await page.capturedEvents()).find(
            (e) => e.event === 'probe for debug properties'
        )
        expect(beforeReloadProbeEvent?.properties?.$sdk_debug_replay_url_trigger_status).toBe('trigger_pending')
        expect(beforeReloadProbeEvent?.properties?.$recording_status).toBe('buffering')

        page.resetCapturedEvents()

        // page doesn't automatically start posthog, so we have to start it on reload
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(
                    {
                        ...startOptions,
                        type: 'reload',
                    },
                    page,
                    page.context()
                )

                await page.resetCapturedEvents()
            },
        })

        await page.evaluate(() => {
            const ph = (window as any).posthog
            ph?.capture('probe for debug properties')
        })

        const probeEvent = (await page.capturedEvents()).find((e) => e.event === 'probe for debug properties')
        expect(probeEvent?.properties?.$sdk_debug_replay_url_trigger_status).toBe('trigger_pending')
        expect(probeEvent?.properties?.$recording_status).toBe('buffering')
    })
})

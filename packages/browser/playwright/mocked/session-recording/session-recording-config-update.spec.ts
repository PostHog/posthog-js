import { RemoteConfig } from '@/types'
import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const startOptions = {
    options: {
        session_recording: {
            // not the default but makes for easier test assertions
            compress_events: false,
        },
    },
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: '/playground/cypress/index.html',
}

test.describe('Session recording - config update while recording', () => {
    /**
     * This test verifies the fix for a race condition where:
     * 1. Recording starts with initial config (no URL triggers)
     * 2. New decide response arrives with URL triggers
     * 3. The new triggers should be applied to the already-running recorder
     *
     * Before the fix, the new triggers would be persisted but never applied,
     * resulting in unwanted recordings even when URL triggers were configured.
     */
    test.describe('URL triggers added after recording starts', () => {
        test.beforeEach(async ({ page, context }) => {
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/*recorder.js*'],
                action: async () => {
                    await start(startOptions, page, context)
                },
            })
            await page.expectCapturedEventsToBe(['$pageview'])
            await page.resetCapturedEvents()
        })

        test('applies new URL triggers when remote config is updated while recording', async ({ page }) => {
            // First verify recording is active with no triggers
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/ses/*'],
                action: async () => {
                    await page.locator('[data-cy-input]').fill('initial activity')
                },
            })

            let events = await page.capturedEvents()
            expect(events.some((e) => e.event === '$snapshot')).toBeTruthy()
            await page.resetCapturedEvents()

            // Now simulate a new remote config arriving with URL triggers
            // This simulates the race condition: recording is already running,
            // but new config arrives with triggers that should block this URL
            const updatedConfig = {
                sessionRecording: {
                    endpoint: '/ses/',
                    urlTriggers: [
                        {
                            url: '/checkout',
                            matching: 'regex',
                        },
                    ],
                } satisfies RemoteConfig['sessionRecording'],
            }

            await page.evaluate((config) => {
                const ph = (window as WindowWithPostHog).posthog
                // Call onRemoteConfig to simulate a new decide response
                ph?.sessionRecording?.onRemoteConfig(config as any)
            }, updatedConfig)

            // The recording should now have the URL trigger applied
            // Since we're not on /checkout, recording should be in buffering mode
            const status = await page.evaluate(() => {
                const ph = (window as WindowWithPostHog).posthog
                return ph?.sessionRecording?.status
            })

            // Status should be buffering because URL trigger is pending (we're not on /checkout)
            expect(status).toEqual('buffering')

            // Verify the custom event was added
            await page.locator('[data-cy-input]').type('more activity')
            await page.waitForTimeout(500)

            events = await page.capturedEvents()
            // Should NOT have new snapshots sent to server since we're buffering
            // (the trigger hasn't matched yet)
            const snapshotAfterUpdate = events.find((e) => e.event === '$snapshot')
            // No snapshot should be sent while buffering
            expect(snapshotAfterUpdate).toBeFalsy()
        })

        test('starts recording when URL matches newly added trigger', async ({ page }) => {
            // First verify recording is active
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/ses/*'],
                action: async () => {
                    await page.locator('[data-cy-input]').fill('initial activity')
                },
            })
            await page.resetCapturedEvents()

            // Update config to add URL trigger that will match current URL
            const updatedConfig = {
                sessionRecording: {
                    endpoint: '/ses/',
                    urlTriggers: [
                        {
                            url: 'cypress', // Will match the current URL
                            matching: 'regex',
                        },
                    ],
                } satisfies RemoteConfig['sessionRecording'],
            }

            await page.evaluate((config) => {
                const ph = (window as WindowWithPostHog).posthog
                ph?.sessionRecording?.onRemoteConfig(config as any)
            }, updatedConfig)

            // Generate activity to trigger the URL check
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/ses/*'],
                action: async () => {
                    await page.locator('[data-cy-input]').type('activity after config update')
                },
            })

            const events = await page.capturedEvents()
            const snapshotEvent = events.find((e) => e.event === '$snapshot')
            expect(snapshotEvent).toBeTruthy()

            // Check that the config update event was recorded
            const snapshotData = snapshotEvent?.properties?.$snapshot_data || []
            const configUpdateEvent = snapshotData.find(
                (s: any) => s.type === 5 && s.data?.tag === '$recording_config_updated'
            )
            expect(configUpdateEvent).toBeTruthy()
        })

        test('applies new event triggers when remote config is updated while recording', async ({ page }) => {
            // First verify recording is active with no triggers
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/ses/*'],
                action: async () => {
                    await page.locator('[data-cy-input]').fill('initial activity')
                },
            })
            await page.resetCapturedEvents()

            // Update config to add event trigger
            const updatedConfig = {
                sessionRecording: {
                    endpoint: '/ses/',
                    eventTriggers: ['special_event'],
                } satisfies RemoteConfig['sessionRecording'],
            }

            await page.evaluate((config) => {
                const ph = (window as WindowWithPostHog).posthog
                ph?.sessionRecording?.onRemoteConfig(config as any)
            }, updatedConfig)

            // Recording should now be buffering waiting for the event trigger
            const status = await page.evaluate(() => {
                const ph = (window as WindowWithPostHog).posthog
                return ph?.sessionRecording?.status
            })
            expect(status).toEqual('buffering')

            // Now capture the special event
            await page.evaluate(() => {
                const ph = (window as WindowWithPostHog).posthog
                ph?.capture('special_event')
            })

            // Recording should now be active
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/ses/*'],
                action: async () => {
                    await page.locator('[data-cy-input]').type('activity after trigger')
                },
            })

            const events = await page.capturedEvents()
            expect(events.some((e) => e.event === '$snapshot')).toBeTruthy()
            expect(events.some((e) => e.event === 'special_event')).toBeTruthy()
        })
    })
})

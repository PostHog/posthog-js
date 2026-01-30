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
    url: './playground/cypress/index.html',
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

    test('adds $recording_config_updated event when config changes while recording', async ({ page }) => {
        // First verify recording is active
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

        // Call onRemoteConfig while recording is running
        // This should trigger updateTriggerConfig() and add the custom event
        await page.evaluate((config) => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.sessionRecording?.onRemoteConfig(config as any)
        }, updatedConfig)

        // Trigger a flush to capture the custom event
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').fill('activity after config update')
            },
        })

        events = await page.capturedEvents()
        const snapshotEvent = events.find((e) => e.event === '$snapshot')
        expect(snapshotEvent).toBeTruthy()

        // Check that the $recording_config_updated custom event was added
        // This proves that updateTriggerConfig() was called
        const snapshotData = snapshotEvent?.properties?.$snapshot_data || []
        const configUpdateEvent = snapshotData.find(
            (s: any) => s.type === 5 && s.data?.tag === '$recording_config_updated'
        )
        expect(configUpdateEvent).toBeTruthy()
        expect(configUpdateEvent.data.payload.urlTriggers).toEqual(1)
    })
})

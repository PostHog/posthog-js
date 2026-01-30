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

    test('updates trigger config when new remote config arrives while recording', async ({ page }) => {
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

        // Verify the config was updated by checking the debug property
        const debugInfo = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            // Check that URL triggers were applied
            const urlTriggers = (ph?.sessionRecording as any)?._lazyLoadedSessionRecording?._urlTriggerMatching?._urlTriggers
            return {
                urlTriggersLength: urlTriggers?.length || 0,
                urlTriggerUrl: urlTriggers?.[0]?.url,
            }
        })

        expect(debugInfo.urlTriggersLength).toEqual(1)
        expect(debugInfo.urlTriggerUrl).toEqual('/checkout')

        // Trigger a flush to capture the custom event
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('activity after config update')
            },
        })

        events = await page.capturedEvents()
        const snapshotEvent = events.find((e) => e.event === '$snapshot')
        expect(snapshotEvent).toBeTruthy()

        // Check that the $recording_config_updated custom event was added
        const snapshotData = snapshotEvent?.properties?.$snapshot_data || []
        const configUpdateEvent = snapshotData.find(
            (s: any) => s.type === 5 && s.data?.tag === '$recording_config_updated'
        )
        expect(configUpdateEvent).toBeTruthy()
        expect(configUpdateEvent.data.payload.urlTriggers).toEqual(1)
    })

    test('updates event triggers when new remote config arrives while recording', async ({ page }) => {
        // First verify recording is active
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

        // Verify the event triggers were applied
        const eventTriggers = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return (ph?.sessionRecording as any)?._lazyLoadedSessionRecording?._eventTriggerMatching?._eventTriggers
        })

        expect(eventTriggers).toEqual(['special_event'])
    })

    test('updates linked flag config when new remote config arrives while recording', async ({ page }) => {
        // First verify recording is active
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').fill('initial activity')
            },
        })
        await page.resetCapturedEvents()

        // Update config to add linked flag
        const updatedConfig = {
            sessionRecording: {
                endpoint: '/ses/',
                linkedFlag: 'test-flag',
            } satisfies RemoteConfig['sessionRecording'],
        }

        await page.evaluate((config) => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.sessionRecording?.onRemoteConfig(config as any)
        }, updatedConfig)

        // Verify the linked flag was applied
        const linkedFlag = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return (ph?.sessionRecording as any)?._lazyLoadedSessionRecording?._linkedFlagMatching?.linkedFlag
        })

        expect(linkedFlag).toEqual('test-flag')
    })
})

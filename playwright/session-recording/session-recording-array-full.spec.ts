import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const startOptions = {
    options: {
        session_recording: {},
    },
    decideResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: './playground/cypress-full/index.html',
}

test.describe('session recording in array.full.js', () => {
    test('captures session events', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.waitingForNetworkCausedBy(['**/ses/*'], async () => {
            await page.locator('[data-cy-input]').fill('hello posthog!')
        })

        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.capture('test_registered_property')
        })

        await page.expectCapturedEventsToBe(['$pageview', '$snapshot', 'test_registered_property'])
        const capturedEvents = await page.capturedEvents()

        // don't care about network payloads here
        const snapshotData = capturedEvents[1]['properties']['$snapshot_data'].filter((s: any) => s.type !== 6)

        // a meta and then a full snapshot
        expect(snapshotData[0].type).toEqual(4) // meta
        expect(snapshotData[1].type).toEqual(2) // full_snapshot
        expect(snapshotData[2].type).toEqual(5) // custom event with remote config
        expect(snapshotData[3].type).toEqual(5) // custom event with options
        expect(snapshotData[4].type).toEqual(5) // custom event with posthog config
        // Making a set from the rest should all be 3 - incremental snapshots
        const incrementalSnapshots = snapshotData.slice(5)
        expect(Array.from(new Set(incrementalSnapshots.map((s: any) => s.type)))).toStrictEqual([3])

        expect(capturedEvents[2]['properties']['$session_recording_start_reason']).toEqual('recording_initialized')
    })
})

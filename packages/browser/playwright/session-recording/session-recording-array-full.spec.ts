import { expect, StartOptions, test } from '../fixtures'

const startOptions: StartOptions = {
    posthogOptions: {
        session_recording: {},
        autocapture: false,
    },
    flagsOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: '/playground/cypress-full/index.html',
}

test.describe('session recording in array.full.js', () => {
    test.use(startOptions)

    test('captures session events', async ({ page, posthog, events }) => {
        await posthog.init()

        await events.waitForEvent('$pageview')
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').pressSequentially('hello posthog!')
            },
        })
        await events.waitForEvent('$snapshot')

        await posthog.capture('test_registered_property')

        await events.waitForEvent('test_registered_property')

        events.expectMatchList(['$pageview', '$snapshot', 'test_registered_property'])

        const snapshotEvent = events.findByName('$snapshot')!

        // don't care about network payloads here
        const snapshotData = snapshotEvent['properties']['$snapshot_data'].filter((s: any) => s.type !== 6)

        // we filter $pageview event as it might be added anywhere in the snapshot data
        const snapshotWithoutPageview = snapshotData.filter((s: any) => s.data.tag !== '$pageview')

        // a meta and then a full snapshot
        expect(snapshotWithoutPageview[0].type).toEqual(4) // meta
        expect(snapshotWithoutPageview[1].type).toEqual(2) // full_snapshot
        expect(snapshotWithoutPageview[2].type).toEqual(5) // custom event with remote config
        expect(snapshotWithoutPageview[3].type).toEqual(5) // custom event with options
        expect(snapshotWithoutPageview[4].type).toEqual(5) // custom event with posthog config
        // Making a set from the rest should all be 3 - incremental snapshots
        const incrementalSnapshots = snapshotWithoutPageview.slice(5)
        expect(Array.from(new Set(incrementalSnapshots.map((s: any) => s.type)))).toStrictEqual([3])
        const customEvent = events.findByName('test_registered_property')!
        expect(customEvent['properties']['$session_recording_start_reason']).toEqual('recording_initialized')
    })
})

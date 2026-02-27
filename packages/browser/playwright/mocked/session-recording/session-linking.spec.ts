import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

const startOptions = {
    options: {
        session_recording: {},
        session_idle_timeout_seconds: 2,
    },
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
        autocapture_opt_out: true,
        __preview_eager_load_replay: false,
    },
    url: './playground/cypress/index.html',
}

test.describe('Session Recording - Session Linking', () => {
    test.beforeEach(async ({ page, context }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(startOptions, page, context)
            },
        })
        await waitForSessionRecordingToStart(page)
        await page.expectCapturedEventsToBe(['$pageview'])
        await page.resetCapturedEvents()
    })

    test('emits session linking events when session times out', async ({ page }) => {
        const firstSessionId = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('hello!')
            },
        })

        const capturedEvents = await page.capturedEvents()
        const firstSnapshot = capturedEvents?.find((e: any) => e.event === '$snapshot')

        const firstSnapshotData = firstSnapshot?.properties?.$snapshot_data
        expect(firstSnapshotData).toBeDefined()

        await page.resetCapturedEvents()

        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.sessionManager?.resetSessionId()
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type(' world!')
            },
        })

        const newSessionId = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })

        expect(firstSessionId).not.toEqual(newSessionId)

        const capturedEventsAfterReset = await page.capturedEvents()
        const secondSnapshot = capturedEventsAfterReset?.find((e: any) => e.event === '$snapshot')

        const secondSnapshotData = secondSnapshot?.properties?.$snapshot_data
        expect(secondSnapshotData).toBeDefined()

        const sessionEndingEvent = firstSnapshotData?.find((s: any) => s.data?.tag === '$session_ending')
        const sessionStartingEvent = secondSnapshotData?.find((s: any) => s.data?.tag === '$session_starting')

        expect(sessionEndingEvent).toBeUndefined()
        expect(sessionStartingEvent).toBeUndefined()
    })

    test('does NOT emit linking events when session changes after reset()', async ({ page }) => {
        const firstSessionId = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('before reset')
            },
        })

        await page.resetCapturedEvents()

        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.reset()
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').clear()
                await page.locator('[data-cy-input]').type('after reset')
            },
        })

        const newSessionId = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })

        expect(firstSessionId).not.toEqual(newSessionId)

        const capturedEventsAfterChange = await page.capturedEvents()
        const snapshots = capturedEventsAfterChange?.filter((e: any) => e.event === '$snapshot')

        expect(snapshots.length).toBeGreaterThan(1)
        const newSessionSnapshot = snapshots.find((s: any) => s.properties?.$session_id === newSessionId)
        expect(newSessionSnapshot).toBeDefined()

        const snapshotData = newSessionSnapshot?.properties?.$snapshot_data

        const sessionEndingEvent = snapshotData?.find((s: any) => s.data?.tag === '$session_ending')
        const sessionStartingEvent = snapshotData?.find((s: any) => s.data?.tag === '$session_starting')

        expect(sessionEndingEvent).toBeUndefined()
        expect(sessionStartingEvent).toBeUndefined()

        const sessionIdChangeEvent = snapshotData?.find((s: any) => s.data?.tag === '$session_id_change')
        expect(sessionIdChangeEvent).toBeDefined()
        expect(sessionIdChangeEvent.data.payload.changeReason.noSessionId).toBe(true)
        expect(sessionIdChangeEvent.data.payload.changeReason.activityTimeout).toBe(false)
        expect(sessionIdChangeEvent.data.payload.changeReason.sessionPastMaximumLength).toBe(false)
    })
})

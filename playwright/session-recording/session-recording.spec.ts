import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import { Page } from '@playwright/test'
import { isUndefined } from '../../src/utils/type-utils'

async function ensureRecordingIsStopped(page: Page) {
    await page.resetCapturedEvents()

    await page.locator('[data-cy-input]').type('hello posthog!')
    // wait a little since we can't wait for the absence of a call to /ses/*
    await page.waitForTimeout(250)

    const capturedEvents = await page.capturedEvents()
    expect(capturedEvents).toEqual([])
}

async function ensureActivitySendsSnapshots(page: Page, expectedCustomTags: string[] = []) {
    await page.resetCapturedEvents()

    const responsePromise = page.waitForResponse('**/ses/*')
    await page.locator('[data-cy-input]').type('hello posthog!')
    await responsePromise

    const capturedEvents = await page.capturedEvents()
    const capturedSnapshot = capturedEvents?.find((e) => e.event === '$snapshot')
    if (isUndefined(capturedSnapshot)) {
        throw new Error('No snapshot captured')
    }

    const capturedSnapshotData = capturedSnapshot['properties']['$snapshot_data'].filter((s: any) => s.type !== 6)
    // first a meta and then a full snapshot
    expect(capturedSnapshotData.shift()?.type).toEqual(4)
    expect(capturedSnapshotData.shift()?.type).toEqual(2)

    // now the list should be all custom events until it is incremental
    // and then only incremental snapshots
    const customEvents = []
    let seenIncremental = false
    for (const snapshot of capturedSnapshotData) {
        if (snapshot.type === 5) {
            expect(seenIncremental).toBeFalsy()
            customEvents.push(snapshot)
        } else if (snapshot.type === 3) {
            seenIncremental = true
        } else {
            throw new Error(`Unexpected snapshot type: ${snapshot.type}`)
        }
    }
    const customEventTags = customEvents.map((s) => s.data.tag)
    expect(customEventTags).toEqual(expectedCustomTags)
}

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
    url: './playground/cypress/index.html',
}

test.describe('Session recording - array.js', () => {
    test.beforeEach(async ({ page, context }) => {
        await page.waitingForNetworkCausedBy(['**/recorder.js*'], async () => {
            await start(startOptions, page, context)
        })
        await page.expectCapturedEventsToBe(['$pageview'])
        await page.resetCapturedEvents()
    })

    test('captures session events', async ({ page }) => {
        const startingSessionId = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })
        await ensureActivitySendsSnapshots(page, ['$remote_config_received', '$session_options', '$posthog_config'])

        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.stopSessionRecording()
        })

        await ensureRecordingIsStopped(page)

        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.startSessionRecording()
        })

        await ensureActivitySendsSnapshots(page, ['$session_options', '$posthog_config'])

        // the session id is not rotated by stopping and starting the recording
        const finishingSessionId = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })
        expect(startingSessionId).toEqual(finishingSessionId)
    })

    test('captures snapshots when the mouse moves', async ({ page }) => {
        // first make sure the page is booted and recording
        await ensureActivitySendsSnapshots(page, ['$remote_config_received', '$session_options', '$posthog_config'])
        await page.resetCapturedEvents()

        const responsePromise = page.waitForResponse('**/ses/*')
        await page.mouse.move(200, 300)
        await page.waitForTimeout(15)
        await page.mouse.move(210, 300)
        await page.waitForTimeout(15)
        await page.mouse.move(220, 300)
        await page.waitForTimeout(15)
        await page.mouse.move(240, 300)
        await page.waitForTimeout(15)
        await responsePromise

        const capturedEvents = await page.capturedEvents()
        const lastCaptured = capturedEvents[capturedEvents.length - 1]
        expect(lastCaptured['event']).toEqual('$snapshot')

        const capturedMouseMoves = lastCaptured['properties']['$snapshot_data'].filter((s: any) => {
            return s.type === 3 && !!s.data?.positions?.length
        })
        expect(capturedMouseMoves.length).toBe(2)
        expect(capturedMouseMoves[0].data.positions.length).toBe(1)
        expect(capturedMouseMoves[0].data.positions[0].x).toBe(200)
        // smoothing varies if this value picks up 220 or 240
        // all we _really_ care about is that it's greater than the previous value
        expect(capturedMouseMoves[1].data.positions.length).toBeGreaterThan(0)
        expect(capturedMouseMoves[1].data.positions[0].x).toBeGreaterThan(200)
    })

    test('continues capturing to the same session when the page reloads', async ({ page }) => {
        await page.waitingForNetworkCausedBy(['**/ses/*'], async () => {
            await page.locator('[data-cy-input]').fill('hello posthog!')
        })

        const firstSessionId = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })
        const capturedEvents = await page.capturedEvents()
        expect(new Set(capturedEvents.map((c) => c['properties']['$session_id']))).toEqual(new Set([firstSessionId]))

        await page.waitingForNetworkCausedBy(['**/recorder.js*'], async () => {
            await start(
                {
                    ...startOptions,
                    type: 'reload',
                },
                page,
                page.context()
            )

            await page.resetCapturedEvents()
        })

        await page.waitingForNetworkCausedBy(['**/ses/*'], async () => {
            await page.locator('[data-cy-input]').type('hello posthog!')
        })

        const capturedAfterActivity = await page.capturedEvents()
        expect(capturedAfterActivity.map((x) => x.event)).toEqual(['$snapshot'])
        expect(capturedAfterActivity[0]['properties']['$session_id']).toEqual(firstSessionId)

        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.capture('some_custom_event')
        })
        await page.expectCapturedEventsToBe(['$snapshot', 'some_custom_event'])
        const capturedAfterReload = await page.capturedEvents()
        expect(capturedAfterReload[1]['properties']['$session_id']).toEqual(firstSessionId)
        expect(capturedAfterReload[1]['properties']['$session_recording_start_reason']).toEqual('recording_initialized')
        expect(capturedAfterReload[1]['properties']['$recording_status']).toEqual('active')
    })

    test('starts a new recording after calling reset', async ({ page }) => {
        await page.resetCapturedEvents()
        const startingSessionId = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })
        expect(startingSessionId).not.toBeNull()

        await ensureActivitySendsSnapshots(page, ['$remote_config_received', '$session_options', '$posthog_config'])

        await page.resetCapturedEvents()
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.reset()
        })

        await page.waitingForNetworkCausedBy(['**/ses/*'], async () => {
            await page.locator('[data-cy-input]').fill('hello posthog!')
        })

        const capturedEvents = await page.capturedEvents()
        const postResetSessionIds = new Set(capturedEvents.map((c) => c['properties']['$session_id']))
        expect(postResetSessionIds.size).toEqual(1)
        const replayCapturedSessionId = Array.from(postResetSessionIds)[0]

        expect(replayCapturedSessionId).not.toEqual(startingSessionId)
    })

    test('rotates sessions after 24 hours', async ({ page }) => {
        await page.waitingForNetworkCausedBy(['**/ses/*'], async () => {
            await page.locator('[data-cy-input]').fill('hello posthog!')
        })

        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.capture('test_registered_property')
        })

        await page.expectCapturedEventsToBe(['$snapshot', 'test_registered_property'])
        const capturedEvents = await page.capturedEvents()

        const firstSessionId = capturedEvents[0]['properties']['$session_id']
        expect(typeof firstSessionId).toEqual('string')
        expect(firstSessionId.trim().length).toBeGreaterThan(10)
        expect(capturedEvents[1]['properties']['$session_recording_start_reason']).toEqual('recording_initialized')

        await page.resetCapturedEvents()
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            const activityTs = ph?.sessionManager?.['_sessionActivityTimestamp']
            const startTs = ph?.sessionManager?.['_sessionStartTimestamp']
            const timeout = ph?.sessionManager?.['_sessionTimeoutMs']

            // move the session values back,
            // so that the next event appears to be greater than timeout since those values
            // @ts-expect-error can ignore that TS thinks these things might be null
            ph.sessionManager['_sessionActivityTimestamp'] = activityTs - timeout - 1000
            // @ts-expect-error can ignore that TS thinks these things might be null
            ph.sessionManager['_sessionStartTimestamp'] = startTs - timeout - 1000
        })

        await page.waitingForNetworkCausedBy(['**/ses/*'], async () => {
            // using fill here means the session id doesn't rotate, must need some kind of user interaction
            await page.locator('[data-cy-input]').type('hello posthog!')
        })

        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.capture('test_registered_property')
        })

        await page.expectCapturedEventsToBe(['$snapshot', 'test_registered_property'])
        const capturedEventsAfter24Hours = await page.capturedEvents()

        expect(capturedEventsAfter24Hours[0]['properties']['$session_id']).not.toEqual(firstSessionId)
        expect(capturedEventsAfter24Hours[0]['properties']['$snapshot_data'][0].type).toEqual(4) // meta
        expect(capturedEventsAfter24Hours[0]['properties']['$snapshot_data'][1].type).toEqual(2) // full_snapshot

        expect(capturedEventsAfter24Hours[1]['properties']['$session_id']).not.toEqual(firstSessionId)
        expect(capturedEventsAfter24Hours[1]['properties']['$session_recording_start_reason']).toEqual(
            'session_id_changed'
        )
    })
})

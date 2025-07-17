import { EventsPage, expect, PosthogPage, StartOptions, test } from '../fixtures'
import { Page } from '@playwright/test'
import { isUndefined } from '../../src/utils/type-utils'
import { BasePage } from '../fixtures/page'
import { CaptureResult } from '../../src/types'

async function ensureRecordingIsStopped(page: Page, events: EventsPage) {
    events.clear()

    await page.locator('[data-cy-input]').fill('hello posthog!')
    // wait a little since we can't wait for the absence of a call to /ses/*
    await page.waitForTimeout(250)

    events.expectMatchList([])
}

async function ensureActivitySendsSnapshots(page: Page, events: EventsPage, expectedCustomTags: string[] = []) {
    events.clear()

    const responsePromise = page.waitForResponse('**/ses/*')
    await page.locator('[data-cy-input]').pressSequentially('hello posthog!')
    await responsePromise

    const capturedEvents = events.all()
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
    url: './playground/cypress/index.html',
}

async function startWith(page: BasePage, posthog: PosthogPage, events: EventsPage) {
    await page.waitingForNetworkCausedBy({
        urlPatternsToWaitFor: ['**/recorder.js*'],
        action: async () => {
            await posthog.init()
        },
    })
    await events.waitForEvent('$pageview')
    events.expectMatchList(['$pageview'])
    events.clear()
    await page.delay(100)
}

test.describe('Session recording - array.js', () => {
    test.use(startOptions)
    test.beforeEach(async ({ page, posthog, events }) => {
        await startWith(page, posthog, events)
    })

    test('captures session events', async ({ page, posthog, events }) => {
        const startingSessionId = await posthog.evaluate((ph) => {
            return ph.get_session_id()
        })
        await ensureActivitySendsSnapshots(page, events, [
            '$remote_config_received',
            '$session_options',
            '$posthog_config',
        ])

        await posthog.evaluate((ph) => {
            ph.stopSessionRecording()
        })

        await ensureRecordingIsStopped(page, events)

        await posthog.evaluate((ph) => {
            ph.startSessionRecording()
        })

        await ensureActivitySendsSnapshots(page, events, ['$session_options', '$posthog_config'])

        // the session id is not rotated by stopping and starting the recording
        const finishingSessionId = await posthog.evaluate((ph) => {
            return ph.get_session_id()
        })
        expect(startingSessionId).toEqual(finishingSessionId)
    })

    test('captures snapshots when the mouse moves', async ({ page, events }) => {
        // first make sure the page is booted and recording
        await ensureActivitySendsSnapshots(page, events, [
            '$remote_config_received',
            '$session_options',
            '$posthog_config',
        ])
        events.clear()

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

        const capturedEvents = events.all()
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

    test('continues capturing to the same session when the page reloads', async ({ page, posthog, events }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').fill('hello posthog!')
            },
        })

        const firstSessionId = await posthog.evaluate((ph) => {
            return ph.get_session_id()
        })
        const capturedEvents = events.all()
        expect(new Set(capturedEvents.map((c) => c['properties']['$session_id']))).toEqual(new Set([firstSessionId]))

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/recorder.js*'],
            action: async () => {
                await page.reloadIdle()
                await posthog.init()
                await events.waitForEvent('$pageview')
                events.clear()
            },
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').fill('hello posthog!')
            },
        })

        const capturedAfterActivity = events.all()
        expect(capturedAfterActivity.map((x) => x.event)).toEqual(['$snapshot'])
        expect(capturedAfterActivity[0]['properties']['$session_id']).toEqual(firstSessionId)

        await posthog.capture('some_custom_event')
        events.expectMatchList(['$snapshot', 'some_custom_event'])
        const capturedAfterReload = events.all()
        expect(capturedAfterReload[1]['properties']['$session_id']).toEqual(firstSessionId)
        expect(capturedAfterReload[1]['properties']['$session_recording_start_reason']).toEqual('recording_initialized')
        expect(capturedAfterReload[1]['properties']['$recording_status']).toEqual('active')
    })

    test('starts a new recording after calling reset', async ({ page, posthog, events }) => {
        events.clear()
        const startingSessionId = await posthog.evaluate((ph) => {
            return ph.get_session_id()
        })
        expect(startingSessionId).not.toBeNull()

        await ensureActivitySendsSnapshots(page, events, [
            '$remote_config_received',
            '$session_options',
            '$posthog_config',
        ])

        events.clear()
        await posthog.evaluate((ph) => {
            ph.reset()
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').fill('hello posthog!')
            },
        })

        const capturedEvents = events.all()
        const postResetSessionIds = new Set(capturedEvents.map((c) => c['properties']['$session_id']))
        expect(postResetSessionIds.size).toEqual(1)
        const replayCapturedSessionId = Array.from(postResetSessionIds)[0]

        expect(replayCapturedSessionId).not.toEqual(startingSessionId)
    })

    test('rotates sessions after 24 hours', async ({ page, posthog, events }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').pressSequentially('hello posthog!')
            },
        })

        await posthog.capture('test_registered_property')

        events.expectMatchList(['$snapshot', 'test_registered_property'])
        const capturedEvents = events.all()

        const firstSessionId = capturedEvents[0]['properties']['$session_id']
        expect(typeof firstSessionId).toEqual('string')
        expect(firstSessionId.trim().length).toBeGreaterThan(10)
        expect(capturedEvents[1]['properties']['$session_recording_start_reason']).toEqual('recording_initialized')

        await page.clock.fastForward(24 * 60 * 60 * 1000) // 24hours
        events.clear()

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                // using fill here means the session id doesn't rotate, must need some kind of user interaction
                await page.locator('[data-cy-input]').pressSequentially('hello posthog!', { delay: 100 })
                // make sure we trigger a recording
                await page.clock.runFor(1000)
            },
        })

        await posthog.capture('test_registered_property')

        events.expectMatchList(['$snapshot', 'test_registered_property'])

        const snapshot = events.get(0) as CaptureResult
        expect(snapshot['properties']['$session_id']).not.toEqual(firstSessionId)
        expect(snapshot['properties']['$snapshot_data'][0].type).toEqual(4) // meta
        expect(snapshot['properties']['$snapshot_data'][1].type).toEqual(2) // full_snapshot

        const testEvent = events.get(1) as CaptureResult
        expect(testEvent['properties']['$session_id']).not.toEqual(firstSessionId)
        expect(testEvent['properties']['$session_recording_start_reason']).toEqual('session_id_changed')
    })

    test('adds debug properties to captured events', async ({ page, posthog, events }) => {
        // make sure recording is running
        await ensureActivitySendsSnapshots(page, events, [
            '$remote_config_received',
            '$session_options',
            '$posthog_config',
        ])

        await posthog.capture('an_event')
        const targetEvent = events.find((e) => e.event === 'an_event')
        expect(targetEvent).toBeDefined()

        expect(targetEvent!['properties']['$session_recording_start_reason']).toEqual('recording_initialized')
        expect(targetEvent!['properties']['$sdk_debug_current_session_duration']).toBeDefined()
        expect(targetEvent!['properties']['$sdk_debug_session_start']).toBeDefined()
    })
})

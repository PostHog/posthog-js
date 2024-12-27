import { expect, test } from './utils/posthog-js-assets-mocks'
import { captures, fullCaptures, resetCaptures, start, WindowWithPostHog } from './utils/setup'
import { Page } from '@playwright/test'
import { isUndefined } from '../src/utils/type-utils'

async function ensureRecordingIsStopped(page: Page) {
    resetCaptures()

    await page.locator('[data-cy-input]').type('hello posthog!')
    // wait a little since we can't wait for the absence of a call to /ses/*
    await page.waitForTimeout(250)
    expect(fullCaptures.length).toBe(0)
}

async function ensureActivitySendsSnapshots(page: Page, expectedCustomTags: string[] = []) {
    resetCaptures()

    const responsePromise = page.waitForResponse('**/ses/*')
    await page.locator('[data-cy-input]').type('hello posthog!')
    await responsePromise

    const capturedSnapshot = fullCaptures.find((e) => e.event === '$snapshot')
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

test.describe('Session recording', () => {
    test.describe('array.full.js', () => {
        test('captures session events', async ({ page, context }) => {
            await start(
                {
                    options: {
                        session_recording: {},
                    },
                    decideResponseOverrides: {
                        isAuthenticated: false,
                        sessionRecording: {
                            endpoint: '/ses/',
                        },
                        capturePerformance: true,
                        autocapture_opt_out: true,
                    },
                },
                page,
                context
            )

            await page.locator('[data-cy-input]').fill('hello world! ')
            await page.waitForTimeout(500)
            const responsePromise = page.waitForResponse('**/ses/*')
            await page.locator('[data-cy-input]').fill('hello posthog!')
            await responsePromise

            await page.evaluate(() => {
                const ph = (window as WindowWithPostHog).posthog
                ph?.capture('test_registered_property')
            })

            expect(captures).toEqual(['$pageview', '$snapshot', 'test_registered_property'])

            // don't care about network payloads here
            const snapshotData = fullCaptures[1]['properties']['$snapshot_data'].filter((s: any) => s.type !== 6)

            // a meta and then a full snapshot
            expect(snapshotData[0].type).toEqual(4) // meta
            expect(snapshotData[1].type).toEqual(2) // full_snapshot
            expect(snapshotData[2].type).toEqual(5) // custom event with remote config
            expect(snapshotData[3].type).toEqual(5) // custom event with options
            expect(snapshotData[4].type).toEqual(5) // custom event with posthog config
            // Making a set from the rest should all be 3 - incremental snapshots
            const incrementalSnapshots = snapshotData.slice(5)
            expect(Array.from(new Set(incrementalSnapshots.map((s: any) => s.type)))).toStrictEqual([3])

            expect(fullCaptures[2]['properties']['$session_recording_start_reason']).toEqual('recording_initialized')
        })
    })

    test.fixme('network capture', () => {})

    test.describe('array.js', () => {
        test.beforeEach(async ({ page, context }) => {
            await start(
                {
                    options: {
                        session_recording: {},
                    },
                    decideResponseOverrides: {
                        isAuthenticated: false,
                        sessionRecording: {
                            endpoint: '/ses/',
                        },
                        capturePerformance: true,
                        autocapture_opt_out: true,
                    },
                    url: './playground/cypress/index.html',
                },
                page,
                context
            )
            await page.waitForResponse('**/recorder.js*')
            expect(captures).toEqual(['$pageview'])
            resetCaptures()
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
            resetCaptures()

            const responsePromise = page.waitForResponse('**/ses/*')
            await page.mouse.move(200, 300)
            await page.waitForTimeout(25)
            await page.mouse.move(210, 300)
            await page.waitForTimeout(25)
            await page.mouse.move(220, 300)
            await page.waitForTimeout(25)
            await page.mouse.move(240, 300)
            await page.waitForTimeout(25)
            await responsePromise

            const lastCaptured = fullCaptures[fullCaptures.length - 1]
            expect(lastCaptured['event']).toEqual('$snapshot')

            const capturedMouseMoves = lastCaptured['properties']['$snapshot_data'].filter((s: any) => {
                return s.type === 3 && !!s.data?.positions?.length
            })
            expect(capturedMouseMoves.length).toBe(2)
            expect(capturedMouseMoves[0].data.positions.length).toBe(1)
            expect(capturedMouseMoves[0].data.positions[0].x).toBe(200)
            expect(capturedMouseMoves[1].data.positions.length).toBe(1)
            // smoothing varies if this value picks up 220 or 240
            // all we _really_ care about is that it's greater than the previous value
            expect(capturedMouseMoves[1].data.positions[0].x).toBeGreaterThan(200)
        })

        test.fixme('continues capturing to the same session when the page reloads', () => {})
        test.fixme('starts a new recording after calling reset', () => {})
        test('rotates sessions after 24 hours', async ({ page }) => {
            await page.locator('[data-cy-input]').fill('hello world! ')
            const responsePromise = page.waitForResponse('**/ses/*')
            await page.locator('[data-cy-input]').fill('hello posthog!')
            await responsePromise

            await page.evaluate(() => {
                const ph = (window as WindowWithPostHog).posthog
                ph?.capture('test_registered_property')
            })

            expect(captures).toEqual(['$snapshot', 'test_registered_property'])

            const firstSessionId = fullCaptures[0]['properties']['$session_id']
            expect(typeof firstSessionId).toEqual('string')
            expect(firstSessionId.trim().length).toBeGreaterThan(10)
            expect(fullCaptures[1]['properties']['$session_recording_start_reason']).toEqual('recording_initialized')

            resetCaptures()
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

            const anotherResponsePromise = page.waitForResponse('**/ses/*')
            // using fill here means the session id doesn't rotate, must need some kind of user interaction
            await page.locator('[data-cy-input]').type('hello posthog!')
            await anotherResponsePromise

            await page.evaluate(() => {
                const ph = (window as WindowWithPostHog).posthog
                ph?.capture('test_registered_property')
            })

            expect(captures).toEqual(['$snapshot', 'test_registered_property'])

            expect(fullCaptures[0]['properties']['$session_id']).not.toEqual(firstSessionId)
            expect(fullCaptures[0]['properties']['$snapshot_data'][0].type).toEqual(4) // meta
            expect(fullCaptures[0]['properties']['$snapshot_data'][1].type).toEqual(2) // full_snapshot

            expect(fullCaptures[1]['properties']['$session_id']).not.toEqual(firstSessionId)
            expect(fullCaptures[1]['properties']['$session_recording_start_reason']).toEqual('session_id_changed')
        })
    })

    test.describe.fixme('with sampling', () => {})
})

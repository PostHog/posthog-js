import { expect, test } from './utils/posthog-js-assets-mocks'
import { captures, fullCaptures, resetCaptures, start, WindowWithPostHog } from './utils/setup'

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
        test.fixme('captures session events', () => {})
        test.fixme('captures snapshots when the mouse moves', () => {})
        test.fixme('continues capturing to the same session when the page reloads', () => {})
        test.fixme('starts a new recording after calling reset', () => {})
        test('rotates sessions after 24 hours', async ({ page, context }) => {
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

            await page.locator('[data-cy-input]').fill('hello world! ')
            const responsePromise = page.waitForResponse('**/ses/*')
            await page.locator('[data-cy-input]').fill('hello posthog!')
            await responsePromise

            await page.evaluate(() => {
                const ph = (window as WindowWithPostHog).posthog
                ph?.capture('test_registered_property')
            })

            expect(captures).toEqual(['$pageview', '$snapshot', 'test_registered_property'])

            const firstSessionId = fullCaptures[1]['properties']['$session_id']
            expect(typeof firstSessionId).toEqual('string')
            expect(firstSessionId.trim().length).toBeGreaterThan(10)
            expect(fullCaptures[2]['properties']['$session_recording_start_reason']).toEqual('recording_initialized')

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

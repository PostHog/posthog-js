import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'
import { Page } from '@playwright/test'

async function ensureRecordingIsStopped(page: Page) {
    // Check recording status without triggering user activity
    const isRecording = await page.evaluate(() => {
        const ph = (window as WindowWithPostHog).posthog
        return ph?.sessionRecording?.started
    })

    expect(isRecording).toBe(false)
}

async function ensureActivitySendsSnapshots(page: Page) {
    await page.resetCapturedEvents()

    const responsePromise = page.waitForResponse('**/ses/*')
    await page.locator('[data-cy-input]').type('hello posthog!')
    await responsePromise

    await expect.poll(async () => (await page.capturedEvents()).some((event) => event.event === '$snapshot')).toBe(true)
}

test.beforeEach(async ({ page }) => {
    await page.clock.install()
})

async function triggerForcedIdleTimeout(page: Page) {
    // Exercise the real idle timer; private emitter names are mangled in browser bundles.
    await page.clock.fastForward(35 * 60 * 1000)
}

function getSnapshotTimestamp(snapshot: any, position: 'first' | 'last'): number {
    const snapshotData = snapshot['properties']['$snapshot_data']
    const index = position === 'first' ? 0 : snapshotData.length - 1
    return snapshotData[index]?.timestamp || snapshotData[index]?.data?.timestamp
}

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

const sampleZeroStartOptions = {
    ...startOptions,
    flagsResponseOverrides: {
        ...startOptions.flagsResponseOverrides,
        sessionRecording: {
            ...startOptions.flagsResponseOverrides.sessionRecording,
            sampleRate: '0',
        },
    },
}

test.describe('Session recording - idle timeout behavior', () => {
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

    test('stops recording when forced idle timeout fires and restarts on user activity', async ({ page }) => {
        await ensureActivitySendsSnapshots(page)

        const initialSessionId = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })
        expect(initialSessionId).toBeDefined()

        await page.resetCapturedEvents()
        await page.locator('[data-cy-input]').type('verify recording active')
        await page.waitForResponse('**/ses/*')
        const verifyEvents = (await page.capturedEvents()).filter((e) => e.event === '$snapshot')
        expect(verifyEvents.length).toBeGreaterThan(0)

        const timestampBeforeIdle = await page.evaluate(() => Date.now())

        await page.waitForTimeout(100)

        // Trigger forced idle timeout
        await triggerForcedIdleTimeout(page)

        // Recording should be stopped
        await ensureRecordingIsStopped(page)

        await page.waitForTimeout(100)

        // User activity should start a new session and restart recording
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.evaluate(() => (window as WindowWithPostHog).posthog?.capture('activity_after_idle'))
                await page.locator('[data-cy-input]').type('new activity after idle!')
            },
        })

        const timestampAfterRestart = await page.evaluate(() => Date.now())

        // Should have a new session ID
        const newSessionId = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })
        expect(newSessionId).not.toEqual(initialSessionId)

        await expect
            .poll(async () =>
                (await page.capturedEvents()).some(
                    (event) => event.event === '$snapshot' && event.properties.$session_id === newSessionId
                )
            )
            .toBe(true)

        // Verify we got a new session with session_id_changed reason
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.capture('test_after_idle_restart')
        })

        const capturedEvents = await page.capturedEvents()
        const snapshots = capturedEvents.filter((e) => e.event === '$snapshot')
        const testEvent = capturedEvents.find((e) => e.event === 'test_after_idle_restart')

        // Retain snapshots on both sides of the idle boundary.
        expect(snapshots.length).toBeGreaterThanOrEqual(2)

        // Old-session data must keep its original identity and timestamp.
        const oldSessionSnapshots = snapshots.filter((s) => s['properties']['$session_id'] === initialSessionId)
        expect(oldSessionSnapshots.length).toBeGreaterThanOrEqual(1)
        expect(getSnapshotTimestamp(oldSessionSnapshots[0], 'last')).toBeLessThan(timestampAfterRestart)

        // New session snapshots should exist
        const newSessionSnapshots = snapshots.filter((s) => s['properties']['$session_id'] === newSessionId)
        expect(newSessionSnapshots.length).toBeGreaterThanOrEqual(1)
        expect(getSnapshotTimestamp(newSessionSnapshots[0], 'first')).toBeGreaterThan(timestampBeforeIdle)

        // Test event should be on new session with correct start reason
        expect(testEvent?.['properties']['$session_id']).toEqual(newSessionId)
        expect(testEvent?.['properties']['$session_recording_start_reason']).toEqual('session_id_changed')
    })

    test('rotates session when event timestamp shows idle timeout exceeded (frozen tab scenario)', async ({ page }) => {
        // This tests the scenario where:
        // 1. A browser tab is frozen/backgrounded for a long time
        // 2. The forcedIdleReset timer never fires (because JS timers don't run when tab is frozen)
        // 3. When the tab unfreezes, rrweb emits events with timestamps far in the future
        // 4. We should detect this via timestamp-based idle detection and rotate the session

        // Start recording normally
        await ensureActivitySendsSnapshots(page)

        const initialSessionId = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })
        expect(initialSessionId).toBeDefined()

        await page.resetCapturedEvents()

        // Simulate "frozen tab" scenario:
        // Make the session appear to have been inactive for 35+ minutes
        // by manipulating the lastActivityTimestamp in persistence and clearing the in-memory cache
        // This simulates what happens when a tab is frozen and the forcedIdleReset timer never fires
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            const persistence = ph?.persistence as any
            const sessionManager = ph?.sessionManager as any

            if (!persistence) {
                throw new Error('Persistence not available')
            }

            if (!sessionManager) {
                throw new Error('SessionManager not available')
            }

            // Get current session data (stored as [lastActivityTimestamp, sessionId, sessionStartTimestamp])
            const sessionIdKey = '$sesid'
            const currentSessionData = persistence.props[sessionIdKey]

            if (!currentSessionData) {
                throw new Error('Session data not found')
            }

            // Set the lastActivityTimestamp to 35 minutes ago
            // This simulates a frozen tab where no activity was recorded
            const thirtyFiveMinutesAgo = Date.now() - 35 * 60 * 1000

            // Write back the modified session data as a NEW array: register()
            // skips reference-equal values, and the doctored timestamp must
            // reach localStorage because the cross-tab refresh re-reads it
            // from storage before declaring the session idle
            persistence.register({
                [sessionIdKey]: [thirtyFiveMinutesAgo, currentSessionData[1], currentSessionData[2]],
            })
            persistence.flush?.()

            // Also clear the session manager's in-memory cache so it reads from persistence
            // This simulates what happens when a tab unfreezes and state needs to be re-read
            sessionManager._sessionActivityTimestamp = null
        })

        // Now trigger user activity
        // This should detect that the session has been idle too long and rotate
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('activity after simulated freeze!')
            },
        })

        const newSessionId = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })

        // The session should have rotated because we exceeded the idle timeout
        expect(newSessionId).not.toEqual(initialSessionId)

        // Capture all snapshot data to see exactly what happened
        const capturedEvents = await page.capturedEvents()
        const snapshots = capturedEvents.filter((e) => e.event === '$snapshot')

        // Collapse to essential fields: session_id, type, tag (for custom events)
        // We don't assert on timestamps as they vary, but we assert on the exact sequence
        const snapshotSummary = snapshots.flatMap((snapshot) => {
            const sessionId = snapshot['properties']['$session_id']
            const snapshotData = snapshot['properties']['$snapshot_data'] as any[]
            return snapshotData.map((event) => ({
                sessionId: sessionId === initialSessionId ? 'initial' : sessionId === newSessionId ? 'new' : 'unknown',
                type: event.type,
                tag: event.data?.tag || null,
            }))
        })

        expect(snapshotSummary.every((event) => event.sessionId !== 'unknown')).toBe(true)
        // Incremental mutations and resource-timing plugin batches depend on browser scheduling.
        // Preserve exact identity/order for the lifecycle and playable bootup events.
        const significantEvents = snapshotSummary.filter((event) => event.type !== 3 && event.type !== 6)
        expect(significantEvents).toEqual([
            // $session_ending is emitted during the callback, before new session starts
            // It MUST go to the initial/old session, not the new one
            { sessionId: 'initial', type: 5, tag: '$session_ending' }, // CustomEvent: marks end of old session

            // New session bootup sequence - rrweb emits these immediately on start()
            // CRITICAL: these MUST be on new session, not initial (the bug we're fixing)
            { sessionId: 'new', type: 4, tag: null }, // Meta event (page metadata)
            { sessionId: 'new', type: 2, tag: null }, // FullSnapshot (DOM state)

            // Config custom events emitted during bootup
            { sessionId: 'new', type: 5, tag: '$remote_config_received' }, // CustomEvent: config
            { sessionId: 'new', type: 5, tag: '$session_options' }, // CustomEvent: recording options
            { sessionId: 'new', type: 5, tag: '$posthog_config' }, // CustomEvent: posthog config

            // Session lifecycle events
            { sessionId: 'new', type: 5, tag: '$session_id_change' }, // CustomEvent: session rotation marker
            { sessionId: 'new', type: 5, tag: '$session_starting' }, // CustomEvent: marks start of new session
        ])
    })
})

test.describe('Session recording - recording idle (activity timeout) within one session', () => {
    // recording idle is the 5-minute activity pause _within_ a session (custom events
    // sessionIdle / sessionNoLongerIdle), not the 30-minute session rotation above
    const idleStartOptions = {
        ...startOptions,
        options: {
            session_recording: {
                compress_events: false,
                // very short so the test can cross the idle threshold quickly
                session_idle_threshold_ms: 600,
            },
        },
    }

    test.beforeEach(async ({ page, context }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(idleStartOptions, page, context)
            },
        })
        await waitForSessionRecordingToStart(page)
        await page.resetCapturedEvents()
    })

    test('takes a full snapshot on wake when the DOM mutated while recording was idle', async ({ page }) => {
        // establish user activity, then stay quiet past the idle threshold
        await page.locator('[data-cy-input]').type('pre idle activity')
        await page.waitForTimeout(800)

        // a non-interactive DOM mutation after the threshold sends the recorder idle;
        // rrweb observes it but the recorder drops it, so the player's mirror goes stale
        await page.evaluate(() => {
            const el = document.createElement('div')
            el.id = 'created-while-going-idle'
            el.textContent = 'swapped in while idle'
            document.body.appendChild(el)
        })
        await page.waitForTimeout(200)

        // keep mutating while idle - all of this is invisible to the event stream
        await page.evaluate(() => {
            document.getElementById('created-while-going-idle')?.remove()
            const el = document.createElement('div')
            el.id = 'swapped-while-idle'
            el.textContent = 'replacement subtree'
            document.body.appendChild(el)
        })
        await page.waitForTimeout(200)

        // user returns: recording must re-sync the player with a fresh full snapshot
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('back from idle')
            },
        })
        const collectSnapshotData = async (): Promise<any[]> => {
            const capturedEvents = await page.capturedEvents()
            return capturedEvents
                .filter((e) => e.event === '$snapshot')
                .flatMap((e) => e['properties']['$snapshot_data'] as any[])
        }

        // poll until the post-wake flush has shipped the wake marker and a full snapshot
        await expect
            .poll(
                async () => {
                    const tags = (await collectSnapshotData()).map((s) => ({ type: s.type, tag: s.data?.tag ?? null }))
                    const wakeIndex = tags.findIndex((s) => s.tag === 'sessionNoLongerIdle')
                    if (wakeIndex === -1) {
                        return 'waiting for sessionNoLongerIdle'
                    }
                    return tags.slice(wakeIndex + 1).some((s) => s.type === 2)
                        ? 'wake full snapshot shipped'
                        : 'waiting for wake full snapshot'
                },
                { timeout: 10000 }
            )
            .toBe('wake full snapshot shipped')

        const snapshotData = await collectSnapshotData()
        const tags = snapshotData.map((s) => ({ type: s.type, tag: s.data?.tag ?? null }))
        const idleIndex = tags.findIndex((s) => s.tag === 'sessionIdle')
        const wakeIndex = tags.findIndex((s) => s.tag === 'sessionNoLongerIdle')
        expect(idleIndex, `expected a sessionIdle event in ${JSON.stringify(tags)}`).toBeGreaterThan(-1)
        expect(wakeIndex, `expected a sessionNoLongerIdle event in ${JSON.stringify(tags)}`).toBeGreaterThan(idleIndex)

        const afterWake = tags.slice(wakeIndex + 1)
        const fullSnapshotAfterWake = afterWake.findIndex((s) => s.type === 2)
        const incrementalAfterWake = afterWake.findIndex((s) => s.type === 3)
        // the mirror-healing full snapshot must exist, and must come before any
        // post-wake incremental, or the player applies mutations to a stale tree
        expect(
            fullSnapshotAfterWake,
            `expected a full snapshot after wake in ${JSON.stringify(afterWake)}`
        ).toBeGreaterThan(-1)
        expect(fullSnapshotAfterWake).toBeLessThan(incrementalAfterWake)

        // the mutations that happened while idle are not in the event stream (they were
        // dropped) - the full snapshot is the only record of them
        const idleEraMutations = snapshotData.filter(
            (s) => s.type === 3 && s.data?.source === 0 && JSON.stringify(s.data).includes('created-while-going-idle')
        )
        expect(idleEraMutations).toEqual([])
        // but the wake full snapshot carries the post-idle DOM state
        const fullSnapshots = snapshotData.filter((s) => s.type === 2)
        const wakeSnapshot = fullSnapshots[fullSnapshots.length - 1]
        expect(JSON.stringify(wakeSnapshot.data)).toContain('swapped-while-idle')
    })
})

test.describe('Session recording - idle timeout with sampling', () => {
    test.beforeEach(async ({ page, context }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(sampleZeroStartOptions, page, context)
            },
        })
        await page.expectCapturedEventsToBe(['$pageview'])
        await page.resetCapturedEvents()
    })

    test('applies sampling rules after forced idle timeout when sampling is 0', async ({ page }) => {
        // With sample rate 0, recording should not start automatically
        await page.locator('[data-cy-input]').type('initial activity')
        await page.waitForTimeout(2500)
        await page.expectCapturedEventsToBe([]) // No recording due to sample rate 0

        // Override sampling to start recording
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.startSessionRecording({ sampling: true })
        })
        await ensureActivitySendsSnapshots(page)

        // Get current session ID
        const sessionIdBeforeIdle = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })

        // Trigger forced idle timeout
        await triggerForcedIdleTimeout(page)

        // Recording should be stopped
        await ensureRecordingIsStopped(page)

        await page.resetCapturedEvents()

        // User activity should create new session but NOT start recording due to sample rate 0
        await page.evaluate(() => (window as WindowWithPostHog).posthog?.capture('activity_after_idle'))
        await page.locator('[data-cy-input]').type('activity after idle timeout')
        await page.waitForTimeout(2500)

        // Verify new session was created
        const sessionIdAfterIdle = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })
        expect(sessionIdAfterIdle).not.toEqual(sessionIdBeforeIdle)

        await expect
            .poll(() => page.evaluate(() => (window as WindowWithPostHog).posthog?.sessionRecording?.status))
            .toBe('disabled')
        await page.expectCapturedEventsToBe(['activity_after_idle'])

        // Verify that sampling override can restart recording even after idle timeout
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.startSessionRecording({ sampling: true })
        })

        // Now recording should start again
        await ensureActivitySendsSnapshots(page)

        // Verify the start reason is sampling_overridden
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.capture('test_after_sampling_override')
        })

        const finalEvents = await page.capturedEvents()
        const testEvent = finalEvents.find((e) => e.event === 'test_after_sampling_override')
        expect(testEvent?.properties['$session_recording_start_reason']).toEqual('sampling_overridden')
    })
})

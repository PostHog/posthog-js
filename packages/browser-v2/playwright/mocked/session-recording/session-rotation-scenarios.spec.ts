import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'
import { Page } from '@playwright/test'

function summariseSnapshot(snapshot: any, initialSessionId: string, newSessionId: string) {
    const sessionId = snapshot.properties.$session_id
    const label = sessionId === initialSessionId ? 'initial' : sessionId === newSessionId ? 'new' : 'unknown'
    const snapshotData: any[] = snapshot.properties.$snapshot_data || []
    return snapshotData.map((event: any) => ({
        sessionId: label,
        type: event.type,
        tag: event.data?.tag || null,
    }))
}

function significantOnly(events: { sessionId: string; type: number; tag: string | null }[]) {
    return events.filter((e) => e.type !== 3)
}

async function simulateSessionExpiry(page: Page): Promise<void> {
    await page.evaluate(() => {
        const ph = (window as WindowWithPostHog).posthog
        const activityTs = ph?.sessionManager?.['_sessionActivityTimestamp']
        const startTs = ph?.sessionManager?.['_sessionStartTimestamp']
        const sessionId = ph?.sessionManager?.['_sessionId']
        const timeout = ph?.sessionManager?.['_sessionTimeoutMs']

        const expiredActivityTs = activityTs! - timeout! - 1000
        const expiredStartTs = startTs! - timeout! - 1000

        // @ts-expect-error - accessing private properties for test
        ph.sessionManager['_sessionActivityTimestamp'] = expiredActivityTs
        // @ts-expect-error - accessing private properties for test
        ph.sessionManager['_sessionStartTimestamp'] = expiredStartTs
        // @ts-expect-error - accessing private properties for test
        ph.persistence.register({ $sesid: [expiredActivityTs, sessionId, expiredStartTs] })
    })
}

async function simulateFrozenTabIdle(page: Page): Promise<void> {
    await page.evaluate(() => {
        const ph = (window as WindowWithPostHog).posthog
        const persistence = ph?.persistence as any
        const sessionManager = ph?.sessionManager as any

        const currentSessionData = persistence.props['$sesid']
        currentSessionData[0] = Date.now() - 35 * 60 * 1000
        persistence.register({ $sesid: currentSessionData })
        sessionManager._sessionActivityTimestamp = null
    })
}

async function triggerForcedIdleTimeout(page: Page): Promise<void> {
    await page.evaluate(() => {
        const ph = (window as WindowWithPostHog).posthog
        const sessionManager = ph?.sessionManager as any
        const oldSessionId = ph?.get_session_id()
        sessionManager.resetSessionId()
        sessionManager._eventEmitter?.emit?.('forcedIdleReset', { idleSessionId: oldSessionId })
    })
}

async function getSessionId(page: Page): Promise<string> {
    const id = await page.evaluate(() => (window as WindowWithPostHog).posthog?.get_session_id())
    expect(id).toBeDefined()
    return id!
}

const startOptions = {
    options: {
        session_recording: {
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

test.describe('Session rotation scenarios', () => {
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

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('baseline activity')
            },
        })
        await page.resetCapturedEvents()
    })

    test('rotates session on activity timeout (frozen tab)', async ({ page }) => {
        const initialSessionId = await getSessionId(page)

        await simulateFrozenTabIdle(page)

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('after freeze!')
            },
        })

        const newSessionId = await getSessionId(page)
        expect(newSessionId).not.toEqual(initialSessionId)

        const capturedEvents = await page.capturedEvents()
        const snapshots = capturedEvents.filter((e) => e.event === '$snapshot')
        const allEvents = snapshots.flatMap((s) => summariseSnapshot(s, initialSessionId, newSessionId))
        const significant = significantOnly(allEvents)

        const oldSessionEvents = significant.filter((e) => e.sessionId === 'initial')
        expect(oldSessionEvents.some((e) => e.tag === '$session_ending')).toBe(true)

        const newSessionEvents = significant.filter((e) => e.sessionId === 'new')
        const nonPlugin = newSessionEvents.filter((e) => e.type !== 6)
        expect(nonPlugin[0]).toMatchObject({ type: 4, tag: null })
        expect(nonPlugin[1]).toMatchObject({ type: 2, tag: null })
        expect(newSessionEvents.some((e) => e.tag === '$session_id_change')).toBe(true)
        expect(newSessionEvents.some((e) => e.tag === '$session_starting')).toBe(true)

        await page.evaluate(() => {
            ;(window as WindowWithPostHog).posthog?.capture('post_rotation_event')
        })
        const allAfter = await page.capturedEvents()
        const analyticsEvent = allAfter.find((e) => e.event === 'post_rotation_event')
        expect(analyticsEvent?.properties.$session_id).toEqual(newSessionId)
        expect(analyticsEvent?.properties.$session_recording_start_reason).toEqual('session_id_changed')
    })

    test('rotates session after simulated expiry', async ({ page }) => {
        const initialSessionId = await getSessionId(page)

        await simulateSessionExpiry(page)
        await page.waitForTimeout(100)

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('after expiry!')
            },
        })

        const newSessionId = await getSessionId(page)
        expect(newSessionId).not.toEqual(initialSessionId)

        const capturedEvents = await page.capturedEvents()
        const snapshots = capturedEvents.filter((e) => e.event === '$snapshot')
        const allEvents = snapshots.flatMap((s) => summariseSnapshot(s, initialSessionId, newSessionId))
        const significant = significantOnly(allEvents)

        const newSessionEvents = significant.filter((e) => e.sessionId === 'new')
        const nonPlugin = newSessionEvents.filter((e) => e.type !== 6)
        expect(nonPlugin[0]).toMatchObject({ type: 4, tag: null })
        expect(nonPlugin[1]).toMatchObject({ type: 2, tag: null })
        expect(newSessionEvents.some((e) => e.tag === '$session_id_change')).toBe(true)

        await page.evaluate(() => {
            ;(window as WindowWithPostHog).posthog?.capture('after_expiry')
        })
        const allAfter = await page.capturedEvents()
        const analyticsEvent = allAfter.find((e) => e.event === 'after_expiry')
        expect(analyticsEvent?.properties.$session_id).toEqual(newSessionId)
        expect(analyticsEvent?.properties.$session_recording_start_reason).toEqual('session_id_changed')
    })

    test('rotates session on forced idle timeout and restarts on activity', async ({ page }) => {
        const initialSessionId = await getSessionId(page)

        await triggerForcedIdleTimeout(page)

        const isStopped = await page.evaluate(() => {
            return (window as WindowWithPostHog).posthog?.sessionRecording?.status === 'disabled'
        })
        expect(isStopped).toBe(false)

        await page.resetCapturedEvents()

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('activity after forced idle!')
            },
        })

        const newSessionId = await getSessionId(page)
        expect(newSessionId).not.toEqual(initialSessionId)

        const capturedEvents = await page.capturedEvents()
        const snapshots = capturedEvents.filter((e) => e.event === '$snapshot')

        const newSessionSnapshots = snapshots.filter((s) => s.properties.$session_id === newSessionId)
        expect(newSessionSnapshots.length).toBeGreaterThanOrEqual(1)
        const snapshotData = newSessionSnapshots[0].properties.$snapshot_data
        const nonPlugin = snapshotData.filter((s: any) => s.type !== 6)
        expect(nonPlugin[0]?.type).toEqual(4)
        expect(nonPlugin[1]?.type).toEqual(2)

        await page.evaluate(() => {
            ;(window as WindowWithPostHog).posthog?.capture('after_forced_idle')
        })
        const allAfter = await page.capturedEvents()
        const analyticsEvent = allAfter.find((e) => e.event === 'after_forced_idle')
        expect(analyticsEvent?.properties.$session_id).toEqual(newSessionId)
        expect(analyticsEvent?.properties.$session_recording_start_reason).toEqual('session_id_changed')
    })

    test('rotates session on posthog.reset() without linking markers', async ({ page }) => {
        const initialSessionId = await getSessionId(page)

        await page.evaluate(() => {
            ;(window as WindowWithPostHog).posthog?.reset()
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').fill('after reset')
            },
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type(' more activity')
            },
        })

        const newSessionId = await getSessionId(page)
        expect(newSessionId).not.toEqual(initialSessionId)

        const capturedEvents = await page.capturedEvents()
        const snapshots = capturedEvents.filter((e) => e.event === '$snapshot')
        const allEvents = snapshots.flatMap((s) => summariseSnapshot(s, initialSessionId, newSessionId))
        const significant = significantOnly(allEvents)

        expect(significant.some((e) => e.tag === '$session_ending')).toBe(false)
        expect(significant.some((e) => e.tag === '$session_starting')).toBe(false)
        expect(significant.some((e) => e.tag === '$session_id_change')).toBe(true)

        const newSessionEvents = significant.filter((e) => e.sessionId === 'new')
        const nonPlugin = newSessionEvents.filter((e) => e.type !== 6)
        expect(nonPlugin[0]).toMatchObject({ type: 4, tag: null })
        expect(nonPlugin[1]).toMatchObject({ type: 2, tag: null })

        const changeEvent = snapshots
            .flatMap((s: any) => s.properties.$snapshot_data)
            .find((e: any) => e.data?.tag === '$session_id_change')
        expect(changeEvent?.data?.payload?.changeReason?.noSessionId).toBe(true)
        expect(changeEvent?.data?.payload?.changeReason?.activityTimeout).toBe(false)
        expect(changeEvent?.data?.payload?.changeReason?.sessionPastMaximumLength).toBe(false)
    })

    test('restarts recorder when analytics event triggers session rotation while idle', async ({ page }) => {
        const initialSessionId = await getSessionId(page)

        await simulateFrozenTabIdle(page)

        await page.evaluate(() => {
            ;(window as WindowWithPostHog).posthog?.capture('$pageleave')
        })

        const newSessionId = await getSessionId(page)
        expect(newSessionId).not.toEqual(initialSessionId)

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('activity after idle rotation!')
            },
        })

        const capturedEvents = await page.capturedEvents()

        const pageleaveEvent = capturedEvents.find((e) => e.event === '$pageleave')
        expect(pageleaveEvent?.properties.$session_id).toEqual(newSessionId)

        const snapshots = capturedEvents.filter((e) => e.event === '$snapshot')
        const newSessionSnapshots = snapshots.filter((s) => s.properties.$session_id === newSessionId)
        expect(newSessionSnapshots.length).toBeGreaterThanOrEqual(1)

        const snapshotData = newSessionSnapshots[0].properties.$snapshot_data
        const nonPlugin = snapshotData.filter((s: any) => s.type !== 6)
        expect(nonPlugin[0]?.type).toEqual(4)
        expect(nonPlugin[1]?.type).toEqual(2)

        const allCustomTags = snapshotData.filter((s: any) => s.type === 5).map((s: any) => s.data?.tag)
        expect(allCustomTags).toContain('$session_id_change')
        expect(allCustomTags).toContain('$session_starting')

        await page.evaluate(() => {
            ;(window as WindowWithPostHog).posthog?.capture('post_idle_rotation_event')
        })
        const allAfter = await page.capturedEvents()
        const postEvent = allAfter.find((e) => e.event === 'post_idle_rotation_event')
        expect(postEvent?.properties.$session_id).toEqual(newSessionId)
        expect(postEvent?.properties.$session_recording_start_reason).toEqual('session_id_changed')
    })

    test('rotates session on external resetSessionId() call', async ({ page }) => {
        const initialSessionId = await getSessionId(page)

        await page.evaluate(() => {
            ;(window as WindowWithPostHog).posthog?.sessionManager?.resetSessionId()
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('after resetSessionId!')
            },
        })

        const newSessionId = await getSessionId(page)
        expect(newSessionId).not.toEqual(initialSessionId)

        const capturedEvents = await page.capturedEvents()
        const snapshots = capturedEvents.filter((e) => e.event === '$snapshot')

        const newSessionSnapshots = snapshots.filter((s) => s.properties.$session_id === newSessionId)
        expect(newSessionSnapshots.length).toBeGreaterThanOrEqual(1)
        const snapshotData = newSessionSnapshots[0].properties.$snapshot_data
        const nonPlugin = snapshotData.filter((s: any) => s.type !== 6)
        expect(nonPlugin[0]?.type).toEqual(4)
        expect(nonPlugin[1]?.type).toEqual(2)

        const allCustomTags = snapshotData.filter((s: any) => s.type === 5).map((s: any) => s.data?.tag)
        expect(allCustomTags).not.toContain('$session_ending')
        expect(allCustomTags).not.toContain('$session_starting')
        expect(allCustomTags).toContain('$session_id_change')
    })

    test('preserves session across page reload', async ({ page, context }) => {
        const initialSessionId = await getSessionId(page)

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start({ ...startOptions, type: 'reload' }, page, context)
                await page.resetCapturedEvents()
            },
        })

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('after reload!')
            },
        })

        expect(await getSessionId(page)).toEqual(initialSessionId)

        const capturedEvents = await page.capturedEvents()
        const snapshots = capturedEvents.filter((e) => e.event === '$snapshot')

        for (const s of snapshots) {
            expect(s.properties.$session_id).toEqual(initialSessionId)
        }

        const allCustomTags = snapshots
            .flatMap((s: any) => s.properties.$snapshot_data)
            .filter((e: any) => e.type === 5)
            .map((e: any) => e.data?.tag)
        expect(allCustomTags).not.toContain('$session_ending')
        expect(allCustomTags).not.toContain('$session_starting')
        expect(allCustomTags).not.toContain('$session_id_change')
    })

    test('stop and start recording preserves session', async ({ page }) => {
        const initialSessionId = await getSessionId(page)

        await page.evaluate(() => {
            ;(window as WindowWithPostHog).posthog?.stopSessionRecording()
        })

        await page.resetCapturedEvents()
        await page.locator('[data-cy-input]').type('while stopped')
        await page.waitForTimeout(250)
        const stoppedEvents = await page.capturedEvents()
        expect(stoppedEvents.filter((e) => e.event === '$snapshot')).toEqual([])

        await page.evaluate(() => {
            ;(window as WindowWithPostHog).posthog?.startSessionRecording()
        })

        await page.resetCapturedEvents()

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('after restart!')
            },
        })

        expect(await getSessionId(page)).toEqual(initialSessionId)

        const capturedEvents = await page.capturedEvents()
        const snapshots = capturedEvents.filter((e) => e.event === '$snapshot')
        const allCustomTags = snapshots
            .flatMap((s: any) => s.properties.$snapshot_data)
            .filter((e: any) => e.type === 5)
            .map((e: any) => e.data?.tag)
        expect(allCustomTags).not.toContain('$session_ending')
        expect(allCustomTags).not.toContain('$session_starting')
        expect(allCustomTags).not.toContain('$session_id_change')
    })
})

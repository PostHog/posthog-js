import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'
import { Page } from '@playwright/test'

// Reproduction hunt for a production attribution bug (posthog-js 1.42x):
// with compress_events on and continuous DOM mutations, an idle -> wake -> reset()+identify()
// sequence has been observed to
//   (a) ship the restarted recorder's Meta+FullSnapshot in batches attributed to the OLD session id,
//   (b) destroy the $session_id_change custom event entirely,
//   (c) leave the new session's first batches with no FullSnapshot and no custom events.
// The SDK's session id was already correct when the snapshots were emitted, so the suspect is the
// buffer/compression-queue/flush layer. Each scenario below runs the shared attribution oracle.
//
// STATUS: reproduced on current master as DESTRUCTION rather than mis-attribution — flaky by
// design of the race (~20-35% of idle-scenario runs, rarer for active ones; run with
// --repeat-each=3 or more). Failing runs show the old session's entire unflushed tail destroyed
// at rotation: clause 5 (tail truncated at the last natural flush, e.g. the sessionIdle
// proactive flush) and clause 4 (sessionNoLongerIdle + wake heal FullSnapshot gone). The
// compression-off control (scenario F) has never failed, implicating the async compression
// queue. Suspect code in src/extensions/replay/external/lazy-loaded-session-recorder.ts:
//   - stop() -> _stopAfterCompressionQueueDrains(): a rotation stop with a non-empty queue
//     defers the old buffer's flush to an async drain;
//   - start() ("Discard the buffer too", the #3822 fix): the synchronous restart invalidates
//     that drain (generation bump) AND clears the buffer, so the deferred flush never ships;
//   - _captureSnapshotBuffered's suppressed-flush branch discards a prior session's buffer
//     rather than relabel it.
// Pre-#3822 builds (field 1.42x) lacked the discard, which would instead ship the mixed buffer
// under the OLD session id — matching field signature (a)/(b) where master now destroys.

const ROTATION_SLACK_MS = 100
const FULL_SNAPSHOT_DEADLINE_MS = 2000

const startOptions = {
    options: {
        session_recording: {
            compress_events: true,
            session_idle_threshold_ms: 600,
            full_snapshot_interval_millis: 60000,
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

interface ChurnWindow {
    __churn?: { start: (delayFirstMouseMs?: number) => void; stop: () => void }
    __recDiag?: () => Record<string, unknown> | null
}

async function installAndStartChurn(page: Page): Promise<void> {
    await page.evaluate(() => {
        const w = window as ChurnWindow & WindowWithPostHog
        // snapshot of the recorder's buffer/compression-queue internals, taken synchronously
        // around interesting moments so failures carry direct evidence of flush-layer state
        w.__recDiag = () => {
            const rec = (w.posthog?.sessionRecording as any)?._lazyLoadedSessionRecording
            if (!rec) {
                return null
            }
            return {
                queuedCompressionEvents: rec._queuedCompressionEvents,
                isStoppingAfterCompression: rec._isStoppingAfterCompression,
                bufferLength: rec._buffer?.data?.length,
                bufferSessionId: rec._buffer?.sessionId,
                bufferFirstTs: rec._buffer?.data?.[0]?.timestamp,
                bufferLastTs: rec._buffer?.data?.[rec._buffer?.data?.length - 1]?.timestamp,
                isIdle: rec._isIdle,
                status: rec.status,
                holdFlushUntilInteraction: rec._holdFlushUntilInteraction,
            }
        }
        if (w.__churn) {
            w.__churn.start()
            return
        }
        const target = document.createElement('div')
        target.id = 'churn-target'
        target.textContent = 'churn 0'
        document.body.appendChild(target)
        let n = 0
        // sizeable, non-repeating payload per mutation so the native async gzip path
        // (CompressionStream) has real work to do and the compression queue stays busy
        const randomPad = () => {
            let s = ''
            while (s.length < 4096) {
                s += Math.random().toString(36).slice(2)
            }
            return s
        }
        let mutationTimer: ReturnType<typeof setInterval> | null = null
        let mouseTimer: ReturnType<typeof setInterval> | null = null
        let mouseDelayTimer: ReturnType<typeof setTimeout> | null = null
        const dispatchMouseBurst = () => {
            n++
            const init = {
                bubbles: true,
                cancelable: true,
                clientX: 10 + (n % 50),
                clientY: 10 + (n % 50),
            }
            for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
                document.body.dispatchEvent(new MouseEvent(type, init))
            }
        }
        w.__churn = {
            // delayFirstMouseMs > 0 matters when resuming after an idle pause: the recorder's
            // idle detection is event-receipt-driven, so the first post-pause event must be a
            // non-active mutation (emits sessionIdle) before any active mouse event (which
            // would otherwise silently reset activity and skip the idle state entirely)
            start(delayFirstMouseMs = 0) {
                if (mutationTimer) {
                    return
                }
                // continuous DOM churn (~every 8ms): text + attribute so rrweb emits
                // type-3 source-0 mutation events
                mutationTimer = setInterval(() => {
                    n++
                    target.textContent = 'churn ' + n + ' ' + randomPad()
                    target.setAttribute('data-churn', String(n))
                }, 8)
                // periodic programmatic mouse activity so interactive (active-source)
                // events flow and the recorder does not idle while churn runs
                const armMouse = () => {
                    dispatchMouseBurst()
                    mouseTimer = setInterval(dispatchMouseBurst, 300)
                }
                if (delayFirstMouseMs > 0) {
                    mouseDelayTimer = setTimeout(armMouse, delayFirstMouseMs)
                } else {
                    armMouse()
                }
            },
            stop() {
                if (mutationTimer) {
                    clearInterval(mutationTimer)
                    mutationTimer = null
                }
                if (mouseTimer) {
                    clearInterval(mouseTimer)
                    mouseTimer = null
                }
                if (mouseDelayTimer) {
                    clearTimeout(mouseDelayTimer)
                    mouseDelayTimer = null
                }
            },
        }
        w.__churn.start()
    })
}

async function stopChurn(page: Page): Promise<void> {
    await page.evaluate(() => {
        ;(window as ChurnWindow).__churn?.stop()
    })
}

async function resumeChurnAfterIdle(page: Page): Promise<void> {
    await page.evaluate(() => {
        // mutations first (trigger sessionIdle on receipt), mouse 200ms later (wakes to
        // sessionNoLongerIdle + heal snapshot) - mirrors a user returning to a live page
        ;(window as ChurnWindow).__churn?.start(200)
    })
}

async function getSessionId(page: Page): Promise<string> {
    const id = await page.evaluate(() => (window as WindowWithPostHog).posthog?.get_session_id())
    expect(id).toBeDefined()
    return id!
}

interface SnapshotBatch {
    sessionId: string
    events: { type: number; timestamp: number; tag: string | null }[]
}

async function collectSnapshotBatches(page: Page): Promise<SnapshotBatch[]> {
    const captured = await page.capturedEvents()
    return captured
        .filter((e) => e.event === '$snapshot')
        .map((e) => ({
            sessionId: e.properties['$session_id'] as string,
            events: ((e.properties['$snapshot_data'] as any[]) || []).map((s: any) => ({
                type: s.type,
                timestamp: s.timestamp,
                // custom-event tags stay plain JSON even with compression on
                tag: (s.data && typeof s.data === 'object' && s.data.tag) || null,
            })),
        }))
}

function describeBatches(batches: SnapshotBatch[], oldSessionId: string, newSessionId: string, rotationTime: number) {
    return batches
        .map((b) => {
            const label = b.sessionId === oldSessionId ? 'OLD' : b.sessionId === newSessionId ? 'NEW' : b.sessionId
            const events = b.events
                .map((e) => `type=${e.type}${e.tag ? `(${e.tag})` : ''}@${e.timestamp - rotationTime}ms`)
                .join(', ')
            return `[${label}] ${events}`
        })
        .join('\n')
}

function runAttributionOracle(
    batches: SnapshotBatch[],
    oldSessionId: string,
    newSessionId: string,
    rotationTime: number,
    { expectIdleMarkers, diag }: { expectIdleMarkers: boolean; diag?: { pre: unknown; post: unknown } }
) {
    // recorder-internal state is only readable on unmangled builds; on the standard dist
    // (property-mangled) __recDiag returns null and the evidence omits it
    const haveDiag = diag && (diag.pre || diag.post)
    const evidence = () =>
        `\nrotation at t=0ms` +
        (haveDiag
            ? `\nrecorder state pre-reset: ${JSON.stringify(diag.pre)}\npost-reset: ${JSON.stringify(diag.post)}`
            : '') +
        `\n${describeBatches(batches, oldSessionId, newSessionId, rotationTime)}`

    const oldBatches = batches.filter((b) => b.sessionId === oldSessionId)
    const newBatches = batches.filter((b) => b.sessionId === newSessionId)

    // sanity: both sessions actually shipped something
    expect(oldBatches.length, `expected old-session batches${evidence()}`).toBeGreaterThan(0)
    expect(newBatches.length, `expected new-session batches${evidence()}`).toBeGreaterThan(0)

    // clause 1: no OLD-session batch may contain any event stamped at/after rotation
    const staleAttributed = oldBatches.flatMap((b) =>
        b.events
            .filter((e) => e.timestamp >= rotationTime + ROTATION_SLACK_MS)
            .map((e) => ({ type: e.type, tag: e.tag, msAfterRotation: e.timestamp - rotationTime }))
    )
    expect(staleAttributed, `clause 1: post-rotation events attributed to the OLD session${evidence()}`).toEqual([])

    // clause 2: exactly one $session_id_change custom event, and it is in a NEW-session batch
    const changeEvents = batches.flatMap((b) =>
        b.events
            .filter((e) => e.tag === '$session_id_change')
            .map((e) => ({ sessionId: b.sessionId, msAfterRotation: e.timestamp - rotationTime }))
    )
    expect(
        changeEvents.length,
        `clause 2: expected exactly one $session_id_change, saw ${JSON.stringify(changeEvents)}${evidence()}`
    ).toEqual(1)
    expect(
        changeEvents[0].sessionId,
        `clause 2: $session_id_change attributed to the wrong session${evidence()}`
    ).toEqual(newSessionId)

    // clause 3: a NEW-session batch contains a FullSnapshot stamped within 2s of rotation
    const newSessionFullSnapshots = newBatches.flatMap((b) => b.events.filter((e) => e.type === 2))
    const timelyFullSnapshot = newSessionFullSnapshots.find(
        (e) => e.timestamp <= rotationTime + FULL_SNAPSHOT_DEADLINE_MS
    )
    expect(
        timelyFullSnapshot,
        `clause 3: no FullSnapshot in a NEW-session batch within ${FULL_SNAPSHOT_DEADLINE_MS}ms of rotation ` +
            `(full snapshots seen: ${JSON.stringify(
                newSessionFullSnapshots.map((e) => e.timestamp - rotationTime)
            )})${evidence()}`
    ).toBeDefined()

    // clause 5: the old session's shipped tail must reach (nearly) up to the rotation.
    // Churn runs continuously right up to reset(), so events existed in that window; a
    // truncated tail means buffered/queued old-session events were destroyed, not shipped
    const lastOldEventTs = Math.max(...oldBatches.flatMap((b) => b.events.map((e) => e.timestamp)))
    expect(
        rotationTime - lastOldEventTs,
        `clause 5: old-session tail truncated - last shipped OLD event is ` +
            `${rotationTime - lastOldEventTs}ms before rotation (churn ran up to rotation)${evidence()}`
    ).toBeLessThan(500)

    // clause 4 (idle scenarios): the wake marker exists and is attributed to the OLD session
    if (expectIdleMarkers) {
        const wakeEvents = batches.flatMap((b) =>
            b.events.filter((e) => e.tag === 'sessionNoLongerIdle').map(() => ({ sessionId: b.sessionId }))
        )
        expect(wakeEvents.length, `clause 4: no sessionNoLongerIdle marker anywhere${evidence()}`).toBeGreaterThan(0)
        expect(
            wakeEvents.every((e) => e.sessionId === oldSessionId),
            `clause 4: sessionNoLongerIdle not attributed to the OLD session: ${JSON.stringify(wakeEvents)}${evidence()}`
        ).toBe(true)
    }
}

async function bootWithChurn(page: Page, context: any, options: typeof startOptions = startOptions): Promise<void> {
    await page.waitingForNetworkCausedBy({
        urlPatternsToWaitFor: ['**/*recorder.js*'],
        action: async () => {
            await start(options, page, context)
        },
    })
    await waitForSessionRecordingToStart(page)
    await page.resetCapturedEvents()

    // start continuous churn and wait for the first flush so the pipeline is proven live
    await page.waitingForNetworkCausedBy({
        urlPatternsToWaitFor: ['**/ses/*'],
        action: async () => {
            await installAndStartChurn(page)
        },
    })
}

// pause everything past the idle threshold, then resume so the recorder emits
// sessionIdle followed by sessionNoLongerIdle + heal snapshot; then postWakeMs of activity
async function goIdleThenWake(page: Page, postWakeMs = 1000): Promise<void> {
    await stopChurn(page)
    await page.waitForTimeout(1200)
    await resumeChurnAfterIdle(page)
    await page.waitForTimeout(postWakeMs)
}

async function settleAndCollect(page: Page, newSessionId: string): Promise<SnapshotBatch[]> {
    // keep mutations running across two flush windows after rotation
    await page.waitForTimeout(4000)
    await stopChurn(page)
    // wait for the new session's data to actually ship
    await expect
        .poll(
            async () => {
                const batches = await collectSnapshotBatches(page)
                return batches.some((b) => b.sessionId === newSessionId && b.events.length > 0)
            },
            { timeout: 8000 }
        )
        .toBe(true)
    // one more flush window so trailing buffered events land
    await page.waitForTimeout(2500)
    return collectSnapshotBatches(page)
}

interface RotationResult {
    rotationTime: number
    pre: Record<string, unknown> | null
    post: Record<string, unknown> | null
}

async function rotateInOneEvaluate(page: Page): Promise<RotationResult> {
    return page.evaluate(() => {
        const w = window as ChurnWindow & WindowWithPostHog
        const pre = w.__recDiag?.() ?? null
        const rotationTime = Date.now()
        w.posthog?.reset()
        w.posthog?.identify('user-after-reset')
        const post = w.__recDiag?.() ?? null
        return { rotationTime, pre, post }
    })
}

test.describe('Session recording - reset()+identify() attribution under load', () => {
    test.describe.configure({ timeout: 60000 })

    test.beforeEach(async ({ page, context }) => {
        await bootWithChurn(page, context)
    })

    test('A: active reset - reset()+identify() back to back while mutations run', async ({ page }) => {
        const oldSessionId = await getSessionId(page)

        const { rotationTime, pre, post } = await rotateInOneEvaluate(page)

        const newSessionId = await getSessionId(page)
        expect(newSessionId).not.toEqual(oldSessionId)

        const batches = await settleAndCollect(page, newSessionId)
        runAttributionOracle(batches, oldSessionId, newSessionId, rotationTime, {
            expectIdleMarkers: false,
            diag: { pre, post },
        })
    })

    test('B: idle, wake, then reset()+identify() in one evaluate', async ({ page }) => {
        const oldSessionId = await getSessionId(page)

        await goIdleThenWake(page)

        const { rotationTime, pre, post } = await rotateInOneEvaluate(page)

        const newSessionId = await getSessionId(page)
        expect(newSessionId).not.toEqual(oldSessionId)

        const batches = await settleAndCollect(page, newSessionId)
        runAttributionOracle(batches, oldSessionId, newSessionId, rotationTime, {
            expectIdleMarkers: true,
            diag: { pre, post },
        })
    })
})

test.describe('Session recording - reset() attribution control (compress_events: false)', () => {
    // control for the compression-queue hypothesis: identical load and rotation, but with
    // the sync (non-queued) compression path - the oracle should always hold here
    test.describe.configure({ timeout: 60000 })

    const uncompressedStartOptions = {
        ...startOptions,
        options: {
            session_recording: {
                ...startOptions.options.session_recording,
                compress_events: false,
            },
        },
    }

    test.beforeEach(async ({ page, context }) => {
        await bootWithChurn(page, context, uncompressedStartOptions)
    })

    test('F: active reset()+identify() while mutations run, compression off', async ({ page }) => {
        const oldSessionId = await getSessionId(page)

        const { rotationTime, pre, post } = await rotateInOneEvaluate(page)

        const newSessionId = await getSessionId(page)
        expect(newSessionId).not.toEqual(oldSessionId)

        const batches = await settleAndCollect(page, newSessionId)
        runAttributionOracle(batches, oldSessionId, newSessionId, rotationTime, {
            expectIdleMarkers: false,
            diag: { pre, post },
        })
    })
})

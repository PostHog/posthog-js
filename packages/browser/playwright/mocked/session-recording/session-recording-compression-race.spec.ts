import { gunzipSync } from 'node:zlib'
import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

const OLD_MARKER = 'audit-old-compression-epoch'
const NEW_MARKER = 'audit-new-compression-epoch'

function decodeEvent(event: any): any {
    if (event.cv !== '2024-10') return event
    const decode = (value: string) => JSON.parse(gunzipSync(Buffer.from(value, 'latin1')).toString())
    if (typeof event.data === 'string') return { ...event, data: decode(event.data) }
    const data = { ...event.data }
    for (const field of ['texts', 'attributes', 'removes', 'adds']) {
        if (typeof data[field] === 'string') data[field] = decode(data[field])
    }
    return { ...event, data }
}

for (const idleBeforeReset of [false, true]) {
    test(`attributes held native gzip across ${idleBeforeReset ? 'idle, wake and ' : ''}reset + identify`, async ({
        page,
        context,
    }) => {
        await page.clock.install()
        await start(
            {
                options: {
                    capture_pageview: false,
                    disable_compression: true,
                    session_recording: {
                        compress_events: true,
                        session_idle_threshold_ms: 1000,
                        full_snapshot_interval_millis: 60000,
                    },
                },
                flagsResponseOverrides: {
                    sessionRecording: { endpoint: '/ses/' },
                    capturePerformance: false,
                    autocapture_opt_out: true,
                },
                url: '/playground/cypress/index.html',
                runBeforePostHogInit: async (pg) => {
                    await pg.evaluate(() => {
                        const NativeCompressionStream = window.CompressionStream
                        let release = () => {}
                        const gate = new Promise<void>((resolve) => {
                            release = resolve
                        })
                        const state = {
                            armed: false,
                            held: false,
                            entered: false,
                            completed: false,
                            release,
                            original: NativeCompressionStream,
                        }
                        ;(window as any).__auditCompression = state
                        window.CompressionStream = class extends NativeCompressionStream {
                            constructor(format: CompressionFormat) {
                                super(format)
                                if (!state.armed || state.held) return
                                state.held = true
                                // Delay real compressed bytes, not a recorder implementation or fake gzip result.
                                const readable = this.readable.pipeThrough(
                                    new TransformStream({
                                        async transform(chunk, controller) {
                                            state.entered = true
                                            await gate
                                            controller.enqueue(chunk)
                                        },
                                        flush() {
                                            state.completed = true
                                        },
                                    })
                                )
                                Object.defineProperty(this, 'readable', { value: readable })
                            }
                        }
                        const target = document.createElement('div')
                        target.id = 'audit-compression-target'
                        target.textContent = 'baseline'
                        document.body.appendChild(target)
                    })
                },
            },
            page,
            context
        )
        try {
            await waitForSessionRecordingToStart(page)
            await page.locator('[data-cy-button]').click()
            await expect
                .poll(async () => (await page.capturedEvents()).filter((e) => e.event === '$snapshot').length)
                .toBeGreaterThan(0)
            const oldIdentity = await page.evaluate(() => {
                const ph = (window as WindowWithPostHog).posthog!
                return { sessionId: ph.get_session_id(), distinctId: ph.get_distinct_id() }
            })
            await page.resetCapturedEvents()
            await page.locator('[data-cy-button]').click()
            await page.evaluate((marker) => {
                ;(window as any).__auditCompression.armed = true
                document.getElementById('audit-compression-target')!.textContent = marker + 'x'.repeat(8192)
            }, OLD_MARKER)
            await page.waitForFunction(() => (window as any).__auditCompression.entered)

            let idleStimulusStart = 0
            if (idleBeforeReset) {
                idleStimulusStart = await page.evaluate(() => Date.now())
                await page.clock.runFor(1200)
                await page.evaluate(async () => {
                    document.getElementById('audit-compression-target')!.setAttribute('data-idle-stimulus', 'true')
                    await new Promise((resolve) => setTimeout(resolve, 0))
                })
            }

            const newIdentity = await page.evaluate((marker) => {
                const ph = (window as WindowWithPostHog).posthog!
                for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
                    document.body.dispatchEvent(new MouseEvent(type, { bubbles: true }))
                }
                document.getElementById('audit-compression-target')!.textContent = marker
                ph.reset()
                ph.identify('audit-user-after-reset')
                return { sessionId: ph.get_session_id(), distinctId: ph.get_distinct_id() }
            }, NEW_MARKER)
            expect(newIdentity.sessionId).toBeTruthy()
            expect(newIdentity.sessionId).not.toBe(oldIdentity.sessionId)
            expect(newIdentity.distinctId).toBe('audit-user-after-reset')
            expect(
                await page.evaluate(() => {
                    const state = (window as any).__auditCompression
                    return state.entered && !state.completed
                })
            ).toBe(true)

            await page.evaluate(() => (window as any).__auditCompression.release())
            await page.locator('[data-cy-button]').click()
            const rows = async () =>
                (await page.capturedEvents())
                    .filter((event) => event.event === '$snapshot')
                    .flatMap((event) =>
                        event.properties.$snapshot_data.map((snapshot: any) => ({
                            sessionId: event.properties.$session_id,
                            distinctId: event.properties.distinct_id,
                            snapshot: decodeEvent(snapshot),
                        }))
                    )
            await expect
                .poll(async () => (await rows()).some((row) => JSON.stringify(row.snapshot).includes(OLD_MARKER)))
                .toBe(true)
            await expect
                .poll(async () =>
                    (await rows()).some(
                        (row) =>
                            row.sessionId === newIdentity.sessionId &&
                            row.snapshot.type === 2 &&
                            JSON.stringify(row.snapshot).includes(NEW_MARKER)
                    )
                )
                .toBe(true)
            await page.waitForTimeout(2500)
            const captured = await rows()
            expect(
                captured.every((row) => [oldIdentity.sessionId, newIdentity.sessionId].includes(row.sessionId))
            ).toBe(true)
            const oldMarkerRows = captured.filter((row) => JSON.stringify(row.snapshot).includes(OLD_MARKER))
            expect(oldMarkerRows.length).toBeGreaterThan(0)
            expect(
                oldMarkerRows.every(
                    (row) => row.sessionId === oldIdentity.sessionId && row.distinctId === oldIdentity.distinctId
                )
            ).toBe(true)
            const newRows = captured.filter((row) => row.sessionId === newIdentity.sessionId)
            expect(newRows.every((row) => row.distinctId === newIdentity.distinctId)).toBe(true)
            expect(
                newRows
                    .filter((row) => row.snapshot.type !== 6)
                    .slice(0, 2)
                    .map((row) => row.snapshot.type)
            ).toEqual([4, 2])
            if (idleBeforeReset) {
                const idleMarkers = captured.filter(
                    (row) =>
                        row.snapshot.data?.tag === 'sessionIdle' &&
                        row.snapshot.timestamp >= idleStimulusStart &&
                        row.sessionId === oldIdentity.sessionId
                )
                expect(idleMarkers.length).toBeGreaterThan(0)
                const wakeMarkers = captured.filter(
                    (row) =>
                        row.snapshot.data?.tag === 'sessionNoLongerIdle' && row.snapshot.timestamp >= idleStimulusStart
                )
                expect(wakeMarkers.length).toBeGreaterThan(0)
                expect(wakeMarkers.every((row) => row.sessionId === oldIdentity.sessionId)).toBe(true)
            }
            expect(await page.evaluate(() => (window as any).__auditCompression.completed)).toBe(true)
        } finally {
            await page.evaluate(() => {
                const state = (window as any).__auditCompression
                if (state) {
                    state.release()
                    window.CompressionStream = state.original
                }
            })
        }
    })
}

import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'
import { Page } from '@playwright/test'

const FIVE_MINUTES = 5 * 60 * 1000
const THIRTY_MINUTES = 30 * 60 * 1000

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

interface SnapshotEvent {
    sessionId: string
    type: number
    timestamp: number
    tag: string | null
    payload: any
}

async function snapshotEvents(page: Page): Promise<SnapshotEvent[]> {
    const captured = await page.capturedEvents()
    return captured
        .filter((e) => e.event === '$snapshot')
        .flatMap((e) =>
            (e.properties.$snapshot_data as any[]).map((event) => ({
                sessionId: e.properties.$session_id as string,
                type: event.type,
                timestamp: event.timestamp,
                tag: event.data?.tag ?? null,
                payload: event.data?.payload,
            }))
        )
}

async function getSessionId(page: Page): Promise<string> {
    const id = await page.evaluate(() => (window as WindowWithPostHog).posthog?.get_session_id())
    expect(id).toBeDefined()
    return id!
}

function pageNow(page: Page): Promise<number> {
    return page.evaluate(() => Date.now())
}

function uuidv7MintTime(id: string): number {
    return parseInt(id.replace(/-/g, '').slice(0, 12), 16)
}

// both rotate through the session manager callback, not through an rrweb interactive event
const rotationTriggers = {
    'posthog.capture': () => {
        ;(window as WindowWithPostHog).posthog?.capture('event_after_idle')
    },
    'sessionManager.checkAndGetSessionAndWindowId': () => {
        ;(window as WindowWithPostHog).posthog?.sessionManager?.checkAndGetSessionAndWindowId(false, Date.now())
    },
}

test.describe('Session rotation from the session manager callback while idle', () => {
    for (const [triggerName, trigger] of Object.entries(rotationTriggers)) {
        test(`new session starts awake with Meta and FullSnapshot when rotated via ${triggerName}`, async ({
            page,
            context,
        }) => {
            await page.clock.install()
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/*recorder.js*'],
                action: async () => {
                    await start(startOptions, page, context)
                },
            })
            await waitForSessionRecordingToStart(page)
            await page.resetCapturedEvents()

            await page.locator('[data-cy-input]').type('hello posthog!')
            await expect
                .poll(async () => (await snapshotEvents(page)).some((e) => e.type === 2), { timeout: 10000 })
                .toBe(true)
            const oldSessionId = await getSessionId(page)

            // past the idle threshold a non-interactive mutation sends the old session confirmed idle
            await page.clock.setSystemTime((await pageNow(page)) + FIVE_MINUTES + 1000)
            await page.evaluate(() => {
                const el = document.createElement('div')
                el.textContent = 'mutated while idle'
                document.body.appendChild(el)
            })
            await expect
                .poll(
                    async () =>
                        (await snapshotEvents(page)).some(
                            (e) => e.sessionId === oldSessionId && e.tag === 'sessionIdle'
                        ),
                    { timeout: 10000 }
                )
                .toBe(true)

            await page.clock.setSystemTime((await pageNow(page)) + THIRTY_MINUTES + 1000)
            const rotationTime = await pageNow(page)
            await page.evaluate(trigger)
            const newSessionId = await getSessionId(page)
            expect(newSessionId).not.toEqual(oldSessionId)

            // a rotation born without interaction holds its buffer until the user interacts
            await page.locator('[data-cy-input]').type('back again')
            await expect
                .poll(async () => (await snapshotEvents(page)).some((e) => e.sessionId === newSessionId), {
                    timeout: 10000,
                })
                .toBe(true)

            const events = await snapshotEvents(page)
            const newSession = events.filter((e) => e.sessionId === newSessionId)
            const oldSession = events.filter((e) => e.sessionId === oldSessionId)
            const describeNew = JSON.stringify(
                newSession.map((e) => ({ type: e.type, tag: e.tag, offset: e.timestamp - rotationTime }))
            )

            expect(
                newSession.filter((e) => e.tag === 'sessionIdle'),
                describeNew
            ).toEqual([])
            expect(
                newSession.filter((e) => e.timestamp < rotationTime - 1000),
                describeNew
            ).toEqual([])
            expect(
                newSession
                    .filter((e) => e.type !== 5)
                    .slice(0, 2)
                    .map((e) => e.type),
                describeNew
            ).toEqual([4, 2])
            expect(Math.min(...newSession.map((e) => e.timestamp)), describeNew).toBeGreaterThanOrEqual(
                uuidv7MintTime(newSessionId) - 1000
            )
            expect(oldSession.some((e) => e.tag === 'sessionIdle' && e.payload?.sessionId === oldSessionId)).toBe(true)
        })
    }
})

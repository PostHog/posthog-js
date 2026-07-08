import { Page, BrowserContext } from '@playwright/test'
import { expect, test, WindowWithPostHog } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

// Cross-tab session lifecycle correctness:
//
//   The user's session must rotate ONLY when every tab has been idle past
//   the configured timeout. An idle tab must not rotate the session while
//   any sibling tab is keeping it alive with events.
//
// What this file covers:
//   - Real `localStorage` sharing between two tabs in the same context.
//   - Real `PostHogPersistence.load()` re-reading on the rotation hot
//     path inside `checkAndGetSessionAndWindowId`.
//   - Both sides of the contract: idle-sibling-survives-active-tab AND
//     all-tabs-idle-still-rotates.
//
// What this file does NOT cover (intentionally):
//   - The real `setTimeout(..., timeout * 1.1)` idle-timer callback —
//     waiting 60+ seconds would make the suite painfully slow, and the
//     Playwright clock's interaction with paused/ticking modes is
//     fiddly. The unit tests in `sessionid.test.ts` (`cross-tab refresh
//     hardening`, `idle detection uses freshest known activity`) cover
//     the timer callback and the re-arm path with fake timers.
//   - Throttle + cross-tab refresh interactions — the 5s
//     `ACTIVITY_TIMESTAMP_PERSIST_GRANULARITY_MS` window is a known
//     blind spot for sibling in-memory-only activity. See
//     `sessionid.ts` near `ACTIVITY_TIMESTAMP_PERSIST_GRANULARITY_MS`.
//
// We synthesize the same call the real timer would make — passing a
// `timestamp` value to `checkAndGetSessionAndWindowId` that puts the
// tab well past the idle threshold — which exercises the exact same
// code path inside `SessionIdManager`.

const TEST_TIMEOUT_SECONDS = 60 // clamped minimum in `SessionIdManager`
const TIMEOUT_MS = TEST_TIMEOUT_SECONDS * 1000

const startOptions = {
    waitForFlags: true,
    options: {
        session_idle_timeout_seconds: TEST_TIMEOUT_SECONDS,
    },
    flagsResponseOverrides: {
        sessionRecording: undefined,
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: './playground/cypress/index.html',
}

// Both tabs need the Playwright clock installed: the base `page` fixture
// (see `playwright/fixtures/page.ts`) auto-installs on the first tab; the
// second tab is created via `context.newPage()` which bypasses the
// fixture, so we install explicitly. Symmetric setup.
async function startSecondTab(context: BrowserContext): Promise<Page> {
    const tab = await context.newPage()
    await tab.clock.install()
    await start(startOptions, tab, context)
    return tab
}

async function getSessionId(page: Page): Promise<string | null | undefined> {
    return page.evaluate(() => (window as WindowWithPostHog).posthog?.get_session_id())
}

// Drive a session-activity write at an explicit simulated time. This is
// the same call `posthog.capture` makes internally — but unlike
// `posthog.capture` we don't follow it with a real-clock `Date.now()`
// write that would clobber the simulated timestamp.
async function writeActivityAt(page: Page, timestampMs: number): Promise<void> {
    await page.evaluate((ts: number) => {
        ;(window as WindowWithPostHog).posthog?.sessionManager?.checkAndGetSessionAndWindowId(false, ts)
    }, timestampMs)
}

// Simulates "the next event capture or idle-timer check at this point in
// simulated time". Returns the resulting session id. Wrapper around the
// typed `sessionManager` accessor — renames on `sessionManager` or
// `checkAndGetSessionAndWindowId` fail typecheck here rather than silently
// breaking the tests.
async function triggerNextEventCheck(page: Page, timestampMs: number): Promise<string | null | undefined> {
    return page.evaluate((ts: number) => {
        return (window as WindowWithPostHog).posthog?.sessionManager?.checkAndGetSessionAndWindowId(false, ts).sessionId
    }, timestampMs)
}

// Two cases of the same shape: one tab writes activity (or doesn't);
// the other tab does its next event-capture check past its own idle
// threshold; we assert whether the session rotated.
//
// `siblingKeepsAlive=true` discriminates the cross-tab refresh fix —
// fails on code that does not re-load from storage before deciding idle.
// `siblingKeepsAlive=false` is a regression guard against the fix
// accidentally keeping dead sessions alive; it does not by itself
// discriminate the fix.
const cases = [
    { label: 'idle sibling tab does not rotate while another tab keeps the session alive', siblingKeepsAlive: true },
    { label: 'session rotates when all tabs have been idle past the timeout', siblingKeepsAlive: false },
]

test.describe('cross-tab session lifecycle', () => {
    test.beforeEach(async ({ page, context }) => {
        await start(startOptions, page, context)
    })

    for (const { label, siblingKeepsAlive } of cases) {
        test(label, async ({ page, context }) => {
            const idleTab = page
            const otherTab = await startSecondTab(context)

            const sharedSessionId = await getSessionId(idleTab)
            expect(sharedSessionId).toBeTruthy()
            expect(await getSessionId(otherTab)).toBe(sharedSessionId)

            const baseTime = await otherTab.evaluate(() => Date.now())

            if (siblingKeepsAlive) {
                // Sibling writes a fresh activity timestamp into shared
                // localStorage. The idle tab has not observed it.
                await writeActivityAt(otherTab, baseTime + TIMEOUT_MS / 6)
            }

            // Idle tab's next session check is well past its own cached
            // idle threshold.
            const sessionAfterCheck = await triggerNextEventCheck(idleTab, baseTime + TIMEOUT_MS + 5_000)

            if (siblingKeepsAlive) {
                expect(sessionAfterCheck).toBe(sharedSessionId)
                expect(await getSessionId(idleTab)).toBe(sharedSessionId)
            } else {
                expect(sessionAfterCheck).toBeTruthy()
                expect(sessionAfterCheck).not.toBe(sharedSessionId)
            }
        })
    }
})

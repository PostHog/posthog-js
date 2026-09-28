import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { waitForSessionRecordingToStart } from '../utils/setup'
import { Page } from '@playwright/test'

const remoteConfig = {
    sessionRecording: { endpoint: '/ses/', minimumDurationMilliseconds: 2000, sampleRate: '1.00' },
    autocapture_opt_out: true,
}

async function initialize(page: Page, token: string) {
    await page.evaluate((projectToken) => {
        const win = window as WindowWithPostHog
        win.posthog!.init(projectToken, {
            api_host: 'https://localhost:1234',
            persistence: 'localStorage',
            persistence_name: 'shared-replay-test',
            strict_script_versioning: false,
            opt_out_useragent_filter: true,
            autocapture: false,
            capture_pageview: false,
            session_recording: { compress_events: false },
            before_send: (event) => {
                if (event) {
                    win.capturedEvents = win.capturedEvents || []
                    win.capturedEvents.push(event)
                }
                return event
            },
        })
    }, token)
}

for (const nextToken of ['project-a', 'project-b']) {
    test(`parked replay stays project-scoped with shared persistence and next token ${nextToken}`, async ({
        page,
        context,
    }) => {
        await page.clock.install()
        await context.route('**/replay-pending-buffer/*', (route) => {
            const label = new URL(route.request().url()).pathname.endsWith('/a') ? 'PAGE_A' : 'PAGE_B'
            return route.fulfill({
                contentType: 'text/html',
                body: `<html><body><h1>${label}</h1><button>Interact</button><input type="password" value="PRIVATE_PASSWORD"><script src="/static/array.js"></script></body></html>`,
            })
        })
        await context.route(/\/array\/[^/]+\/config\.js(\?|$)/, (route) =>
            route.fulfill({ contentType: 'application/javascript', body: '' })
        )
        await context.route(/\/array\/[^/]+\/config(\?|$)/, (route) => route.fulfill({ json: remoteConfig }))
        await context.route('**/flags/*', (route) => route.fulfill({ json: remoteConfig }))

        await page.goto('/replay-pending-buffer/a')
        await initialize(page, 'project-a')
        await waitForSessionRecordingToStart(page)
        await page.locator('button').click()
        const previous = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog!
            const ids = ph.sessionManager!.checkAndGetSessionAndWindowId(true)
            // Exercise a cold start with persisted config from a core predating cache_timestamp.
            const legacyConfig = { ...ph.get_property('$session_recording_remote_config') }
            delete legacyConfig.cache_timestamp
            ph.persistence!.register({ $session_recording_remote_config: legacyConfig })
            return { ...ids, now: Date.now() }
        })
        expect(previous.now - previous.sessionStartTimestamp).toBeLessThan(2000)
        expect((await page.capturedEvents()).filter((event) => event.event === '$snapshot')).toEqual([])

        let releaseConfig!: () => void
        const configGate = new Promise<void>((resolve) => {
            releaseConfig = resolve
        })
        let configRequested = false
        await context.route(/\/array\/[^/]+\/config(\?|$)/, async (route) => {
            configRequested = true
            await configGate
            await route.fulfill({ json: remoteConfig })
        })
        try {
            await page.goto('/replay-pending-buffer/b')
            await initialize(page, nextToken)
            await expect.poll(() => configRequested).toBe(true)
            expect((await page.capturedEvents()).filter((event) => event.event === '$snapshot')).toEqual([])
        } finally {
            releaseConfig()
        }
        await waitForSessionRecordingToStart(page)
        const current = await page.evaluate(() =>
            (window as WindowWithPostHog).posthog!.sessionManager!.checkAndGetSessionAndWindowId(true)
        )
        expect(current.sessionId).toBe(previous.sessionId)
        expect(current.windowId).toBe(previous.windowId)
        await page.clock.runFor(2500)
        await page.locator('button').click()
        await page.clock.runFor(3000)

        const snapshots = (await page.capturedEvents()).filter((event) => event.event === '$snapshot')
        expect(snapshots.length).toBeGreaterThan(0)
        const snapshotData = JSON.stringify(snapshots.map((event) => event.properties.$snapshot_data))
        expect(snapshotData).toContain('PAGE_B')
        expect(snapshotData.includes('PAGE_A')).toBe(nextToken === 'project-a')
        expect(snapshotData).not.toContain('PRIVATE_PASSWORD')
    })
}

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const open = async (page: Page, entry: 'root' | 'static' | 'core') => {
    await page.goto(`/replay-${entry}`)
    await page.waitForFunction(() => !!window.replayHarness)
}
const ready = async (page: Page) => expect.poll(() => page.evaluate(() => window.replayHarness.ready())).toBe(true)
const activity = async (page: Page) => {
    await page.locator('#activity').click()
    await page.waitForTimeout(100)
}

test('built root and manual core do not start products or touch storage on import; disabled replay does not load', async ({
    page,
}) => {
    const chunks: string[] = []
    page.on('request', (request) => chunks.push(request.url()))
    await page.addInitScript(() => {
        const effects: string[] = []
        Object.assign(window, { importEffects: effects })
        for (const name of ['setItem', 'getItem', 'removeItem'] as const) {
            const original = Storage.prototype[name]
            Object.defineProperty(Storage.prototype, name, {
                configurable: true,
                writable: true,
                value: function (this: Storage, ...args: string[]) {
                    effects.push(name)
                    return Reflect.apply(original, this, args)
                },
            })
        }
    })
    for (const entry of ['root', 'core'] as const) {
        await open(page, entry)
        expect(await page.evaluate(() => (window as unknown as { importEffects: string[] }).importEffects)).toEqual([])
        expect(await page.evaluate(() => '__PosthogExtensions__' in window)).toBe(false)
        await page.evaluate((disabled) => window.replayHarness.initialize({ disabled }), entry === 'root')
        await page.waitForTimeout(100)
        expect(await page.evaluate(() => window.replayHarness.ready())).toBe(false)
        expect(chunks.filter((url) => /replay-runtime-/.test(url))).toEqual([])
    }
})

for (const entry of ['root', 'static'] as const) {
    test(`${entry}: remote and consent gates defer rrweb, then grant starts recording`, async ({ page }) => {
        const chunks: string[] = []
        page.on('request', (request) => chunks.push(request.url()))
        await open(page, entry)
        expect(chunks.some((url) => /replay-runtime-/.test(url))).toBe(false)
        await page.evaluate(() => window.replayHarness.initialize({ enabled: false }))
        await page.waitForTimeout(100)
        expect(chunks.some((url) => /replay-runtime-/.test(url))).toBe(false)
        await page.evaluate(() => window.replayHarness.initialize({ denied: true }))
        await page.waitForTimeout(100)
        expect(chunks.some((url) => /replay-runtime-/.test(url))).toBe(false)
        await page.evaluate(() => window.replayHarness.optIn())
        await ready(page)
        expect(chunks.some((url) => /replay-runtime-/.test(url))).toBe(true)
        expect(await page.evaluate(() => '__PosthogExtensions__' in window)).toBe(false)
        await page.evaluate(() => window.replayHarness.shutdown())
    })

    test(`${entry}: real masked snapshots play back and keep analytics/session authority across identify and reset`, async ({
        page,
    }) => {
        await open(page, entry)
        await page.evaluate(() => window.replayHarness.initialize())
        await ready(page)
        await activity(page)
        await page.locator('#private').fill('live-secret')
        await page.waitForTimeout(100)
        await page.evaluate(() => window.replayHarness.flush())
        const oldId = await page.evaluate(() => window.replayHarness.distinctId())
        const oldSession = await page.evaluate(() => window.replayHarness.session())
        let snapshots = await page.evaluate(() => window.replayHarness.snapshots())
        expect(snapshots.length).toBeGreaterThan(0)
        expect(snapshots[0]!.properties).toMatchObject({
            distinct_id: oldId,
            $session_id: oldSession!.sessionId,
            $window_id: oldSession!.windowId,
        })
        expect(
            snapshots.flatMap((snapshot) => snapshot.properties.$snapshot_data).some((event) => event.type === 2)
        ).toBe(true)
        expect(JSON.stringify(snapshots)).not.toContain('initial-secret')
        expect(JSON.stringify(snapshots)).not.toContain('live-secret')
        await page.evaluate(() => window.replayHarness.identify('known-person'))
        await activity(page)
        await page.evaluate(() => window.replayHarness.flush())
        expect(await page.evaluate(() => window.replayHarness.session())).toEqual(oldSession)
        expect((await page.evaluate(() => window.replayHarness.snapshots())).at(-1)!.properties.distinct_id).toBe(
            'known-person'
        )
        // A tail present at reset must be admitted while the previous identity still owns it.
        await page.locator('#private').fill('before-reset-secret')
        await page.waitForTimeout(100)
        await page.evaluate(() => window.replayHarness.reset())
        await activity(page)
        await expect
            .poll(() => page.evaluate(() => window.replayHarness.session()?.sessionId))
            .not.toBe(oldSession!.sessionId)
        await page.locator('#private').fill('after-reset-secret')
        await page.waitForTimeout(100)
        await page.evaluate(() => window.replayHarness.flush())
        snapshots = await page.evaluate(() => window.replayHarness.snapshots())
        const newSession = await page.evaluate(() => window.replayHarness.session())
        const newId = await page.evaluate(() => window.replayHarness.distinctId())
        expect(
            snapshots.some(
                (snapshot) =>
                    snapshot.properties.distinct_id === 'known-person' &&
                    snapshot.properties.$session_id === oldSession!.sessionId
            )
        ).toBe(true)
        expect(
            snapshots.some(
                (snapshot) =>
                    snapshot.properties.distinct_id === newId &&
                    snapshot.properties.$session_id === newSession!.sessionId &&
                    snapshot.properties.$snapshot_data.some((event) => event.type === 2)
            )
        ).toBe(true)
        expect(
            (await page.evaluate(() => window.replayHarness.requests())).every((url) => new URL(url).pathname === '/s/')
        ).toBe(true)
        const playback = await page.evaluate(() => window.replayHarness.playback())
        expect(playback).toContain('Replay fixture')
        expect(playback).not.toContain('secret')
        await page.evaluate(() => window.replayHarness.shutdown())
    })
}

for (const ending of ['pagehide', 'shutdown', 'shutdown-reentrant', 'shutdown-denied'] as const) {
    test(`${ending} delivers stylesheets deferred by the recording budget`, async ({ page }) => {
        await page.addInitScript(() => {
            window.requestIdleCallback = () => 1
            window.cancelIdleCallback = () => {}
        })
        await page.route('**/first.css', (route) =>
            route.fulfill({ contentType: 'text/css', body: '.first { color: red; }' })
        )
        await page.route('**/deferred.css', (route) =>
            route.fulfill({ contentType: 'text/css', body: '.deferred-tail { color: blue; }' })
        )
        await open(page, 'root')
        await page.evaluate(async (ending) => {
            for (const href of ['/first.css', '/deferred.css']) {
                await new Promise<void>((resolve) => {
                    const link = document.createElement('link')
                    link.rel = 'stylesheet'
                    link.href = href
                    link.onload = () => resolve()
                    document.head.appendChild(link)
                })
            }
            await window.replayHarness.initialize({
                replayOptions: { inlineStylesheetBudgetRules: 1 },
                ...(ending === 'shutdown-reentrant' ? { reentrantStop: 'mutate' as const } : {}),
                ...(ending === 'shutdown-denied' ? { reentrantStop: 'deny' as const } : {}),
            })
        }, ending)
        await ready(page)
        await activity(page)
        const originalSession = await page.evaluate(() => window.replayHarness.session())
        const originalIdentity = await page.evaluate(() => window.replayHarness.distinctId())
        if (ending.startsWith('shutdown')) await page.evaluate(() => window.replayHarness.shutdown())
        else
            await page.evaluate(() => {
                window.dispatchEvent(new Event('beforeunload'))
                window.dispatchEvent(new PageTransitionEvent('pagehide'))
            })
        if (ending === 'shutdown-denied') {
            expect(await page.evaluate(() => window.replayHarness.snapshots())).toEqual([])
        } else {
            await expect
                .poll(() => page.evaluate(() => JSON.stringify(window.replayHarness.snapshots())))
                .toContain('.deferred-tail')
            const snapshots = await page.evaluate(() => window.replayHarness.snapshots())
            expect(new Set(snapshots.map((snapshot) => snapshot.uuid)).size).toBe(snapshots.length)
            expect(
                snapshots.every(
                    (snapshot) =>
                        snapshot.properties.$session_id === originalSession!.sessionId &&
                        snapshot.properties.distinct_id === originalIdentity
                )
            ).toBe(true)
        }
        if (ending.includes('reentrant') || ending.includes('denied')) {
            expect(await page.evaluate(() => window.replayHarness.stopCallbacks())).toBe(1)
            expect(await page.evaluate(() => window.replayHarness.capturedEvents())).toEqual([])
            expect(await page.evaluate(() => window.replayHarness.distinctId())).toBe(originalIdentity)
            expect(await page.evaluate(() => window.replayHarness.session())).toEqual(originalSession)
        }
        await page.evaluate(() => window.replayHarness.optOut())
        await page.evaluate(() => window.replayHarness.shutdown())
    })
}

test('shutdown preserves minimum-duration buffering', async ({ page }) => {
    await open(page, 'root')
    await page.evaluate(() => window.replayHarness.initialize({ minimumDurationMs: 60000 }))
    await ready(page)
    await activity(page)
    await page.evaluate(() => window.replayHarness.shutdown())
    expect(await page.evaluate(() => window.replayHarness.snapshots())).toEqual([])
})

test('shutdown preserves the shared sampled-out decision', async ({ page }) => {
    await open(page, 'root')
    await page.evaluate(() => window.replayHarness.initialize({ replayOptions: { sampleRate: 0 } }))
    await ready(page)
    await activity(page)
    await page.evaluate(() => window.replayHarness.shutdown())
    expect(await page.evaluate(() => window.replayHarness.snapshots())).toEqual([])
})

test('shutdown delivers already recorded snapshots without a prior flush', async ({ page }) => {
    await open(page, 'root')
    await page.evaluate(() => window.replayHarness.initialize())
    await ready(page)
    await activity(page)
    await page.evaluate(() => window.replayHarness.shutdown())
    expect((await page.evaluate(() => window.replayHarness.snapshots())).length).toBeGreaterThan(0)
})

test('denial discards queued and producer snapshots; grant restarts and disposal detaches producers', async ({
    page,
}) => {
    await open(page, 'root')
    await page.evaluate(() => window.replayHarness.initialize())
    await ready(page)
    await activity(page)
    await page.locator('#private').fill('unsubmitted')
    await page.evaluate(() => window.replayHarness.optOut())
    await page.evaluate(() => window.replayHarness.flush())
    expect(await page.evaluate(() => window.replayHarness.snapshots())).toEqual([])
    await page.evaluate(() => window.replayHarness.optIn())
    await page.waitForTimeout(100)
    await activity(page)
    await page.evaluate(() => window.replayHarness.flush())
    expect((await page.evaluate(() => window.replayHarness.snapshots())).length).toBeGreaterThan(0)
    await page.evaluate(() => window.replayHarness.shutdown())
    const count = await page.evaluate(() => window.replayHarness.snapshots().length)
    await activity(page)
    await page.evaluate(() => {
        window.dispatchEvent(new Event('beforeunload'))
        window.dispatchEvent(new PageTransitionEvent('pagehide'))
    })
    await page.waitForTimeout(100)
    expect(await page.evaluate(() => window.replayHarness.snapshots().length)).toBe(count)
})

for (const rotate of [false, true]) {
    test(`beforeunload then pagehide hands off each batch once after final recorder drain (rotation=${rotate})`, async ({
        page,
    }) => {
        await open(page, 'root')
        await page.evaluate(() => window.replayHarness.initialize())
        await ready(page)
        await activity(page)
        if (rotate) {
            await page.evaluate(() => window.replayHarness.reset())
            await activity(page)
        }
        await page.evaluate(() => {
            window.dispatchEvent(new Event('beforeunload'))
            window.dispatchEvent(new PageTransitionEvent('pagehide'))
        })
        await expect.poll(() => page.evaluate(() => window.replayHarness.handoffs())).toBeGreaterThan(0)
        await expect.poll(() => page.evaluate(() => window.replayHarness.snapshots().length)).toBeGreaterThan(0)
        const ids = await page.evaluate(() => window.replayHarness.snapshots().map((snapshot) => snapshot.uuid))
        expect(new Set(ids).size).toBe(ids.length)
        await page.evaluate(() => window.replayHarness.optOut())
        await page.evaluate(() => window.replayHarness.shutdown())
    })
}

for (const action of ['optOut', 'shutdown'] as const) {
    test(`a late rrweb chunk cannot revive recording after ${action}`, async ({ page }) => {
        let release!: () => Promise<void>
        await page.route('**/chunks/replay-runtime-*.js', async (route) => {
            release = () => route.continue()
        })
        await open(page, 'root')
        await page.evaluate(() => window.replayHarness.initialize())
        await expect.poll(() => !!release).toBe(true)
        await page.evaluate((action) => window.replayHarness[action](), action)
        await release()
        await activity(page)
        expect(await page.evaluate(() => window.replayHarness.ready())).toBe(false)
        expect(await page.evaluate(() => window.replayHarness.snapshots())).toEqual([])
        if (action === 'optOut') {
            await page.evaluate(() => window.replayHarness.optIn())
            await ready(page)
            await activity(page)
            await page.evaluate(() => window.replayHarness.flush())
            expect((await page.evaluate(() => window.replayHarness.snapshots())).length).toBeGreaterThan(0)
        }
        await page.evaluate(() => window.replayHarness.shutdown())
    })
}

test('replay shares the browser state session with sibling tabs while keeping distinct window IDs', async ({
    page,
    context,
}) => {
    await open(page, 'root')
    await page.evaluate(() => window.replayHarness.initialize({ persistent: true }))
    await ready(page)
    const sibling = await context.newPage()
    await open(sibling, 'root')
    await sibling.evaluate(() => window.replayHarness.initialize({ persistent: true }))
    await ready(sibling)
    const first = await page.evaluate(() => window.replayHarness.session())
    const second = await sibling.evaluate(() => window.replayHarness.session())
    expect(first!.sessionId).toBe(second!.sessionId)
    expect(first!.windowId).not.toBe(second!.windowId)
    await page.evaluate(() => window.replayHarness.optOut())
    await sibling.waitForTimeout(100)
    await activity(sibling)
    await sibling.evaluate(() => window.replayHarness.flush())
    expect(await sibling.evaluate(() => window.replayHarness.snapshots())).toEqual([])
    await Promise.all([
        page.evaluate(() => window.replayHarness.shutdown()),
        sibling.evaluate(() => window.replayHarness.shutdown()),
    ])
})

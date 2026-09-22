import path from 'path'
import { writeFile } from 'fs/promises'
import { test, expect, type Browser } from '@playwright/test'
import type { WindowWithPostHog } from '../utils/posthog-playwright-test-base'

const releasedCoreDir = process.env.REPLAY_RELEASED_CORE_DIR
const baselineDist = process.env.REPLAY_BASELINE_DIST

const combinations = [
    { version: '1.268.5', eager: true, script: 'recorder.js' },
    { version: '1.268.5', eager: false, script: 'lazy-recorder.js' },
    { version: '1.268.6', eager: true, script: 'recorder.js' },
    { version: '1.268.6', eager: false, script: 'lazy-recorder.js' },
    { version: '1.400.0', script: 'lazy-recorder.js' },
]

type Snapshot = { properties: Record<string, any> }

type BeaconWindow = typeof window & { replayBeaconBodies: Array<{ url: string; body: Promise<string> }> }

function snapshotEvents(body: string): Snapshot[] {
    let payload: any
    try {
        payload = JSON.parse(body)
    } catch {
        const encoded = new URLSearchParams(body).get('data')
        if (!encoded) throw new Error('Missing replay request data')
        payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
    }
    return (Array.isArray(payload) ? payload : [payload]).filter((event) => event.event === '$snapshot')
}

async function exerciseCore(
    browser: Browser,
    baseURL: string,
    combination: (typeof combinations)[number],
    recorderDist: string
) {
    const context = await browser.newContext({ baseURL })
    const snapshots: Snapshot[] = []
    const loadedScripts: string[] = []
    const unexpectedRequests: string[] = []
    const pageErrors: string[] = []
    const remoteConfig = { sessionRecording: { endpoint: '/ses/', minimumDurationMilliseconds: 0, sampleRate: 1 } }
    try {
        // WebKit's request interception omits Blob beacon bodies. Observe the exact body passed to
        // sendBeacon while still calling the native transport; use it only when interception lacks data.
        await context.addInitScript(() => {
            const win = window as BeaconWindow
            win.replayBeaconBodies = []
            const sendBeacon = navigator.sendBeacon.bind(navigator)
            navigator.sendBeacon = (url, body) => {
                win.replayBeaconBodies.push({
                    url: new URL(url, window.location.href).href,
                    body: body instanceof Blob ? body.text() : Promise.resolve(String(body)),
                })
                return sendBeacon(url, body)
            }
        })
        // Every request is fulfilled locally or aborted, including asset URLs on historical CDN hosts.
        await context.route('**/*', async (route) => {
            const url = new URL(route.request().url())
            if (url.pathname === '/released-replay-fixture') {
                return route.fulfill({
                    contentType: 'text/html',
                    body: '<!doctype html><html><body><input id="input"><button id="button">Interact</button></body></html>',
                })
            }
            if (url.pathname === '/released-core.js') {
                return route.fulfill({
                    contentType: 'text/javascript',
                    path: path.join(releasedCoreDir!, combination.version, 'package/dist/array.js'),
                })
            }
            const script = url.pathname.match(/\/static\/(?:[^/]+\/)?((?:lazy-recorder|recorder)\.js)$/)?.[1]
            if (script) {
                loadedScripts.push(script)
                return route.fulfill({ contentType: 'text/javascript', path: path.join(recorderDist, script) })
            }
            if (/\/array\/[^/]+\/config\.js$/.test(url.pathname)) {
                return route.fulfill({
                    contentType: 'text/javascript',
                    body: `window._POSTHOG_REMOTE_CONFIG = {"replay-local-test": {config: ${JSON.stringify(remoteConfig)}}}`,
                })
            }
            if (/\/array\/[^/]+\/config$|\/(?:flags|decide)\/?$/.test(url.pathname)) {
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify(remoteConfig) })
            }
            if (/\/ses\/?$/.test(url.pathname)) {
                const request = route.request()
                const body =
                    request.postData() ??
                    (await request
                        .frame()
                        .page()
                        .evaluate(async (url) => {
                            const beacons = (window as BeaconWindow).replayBeaconBodies
                            const index = beacons.findIndex((beacon) => beacon.url === url)
                            if (index < 0)
                                throw new Error(
                                    'Replay request has neither intercepted data nor an observed beacon body'
                                )
                            return await beacons.splice(index, 1)[0].body
                        }, request.url()))
                snapshots.push(...snapshotEvents(body))
                return route.fulfill({ contentType: 'application/json', body: '{"status":1}' })
            }
            if (/\/(?:e|s)\/?$|\/i\/v0\/e\/?$/.test(url.pathname)) {
                return route.fulfill({ contentType: 'application/json', body: '{"status":1}' })
            }
            unexpectedRequests.push(url.href)
            return route.abort()
        })
        const page = await context.newPage()
        page.on('pageerror', (error) => pageErrors.push(error.message))
        await page.goto('/released-replay-fixture')
        await page.addScriptTag({ url: '/released-core.js' })
        await page.evaluate((eager) => {
            const posthog = (window as WindowWithPostHog).posthog!
            const config = {
                api_host: window.location.origin,
                opt_out_useragent_filter: true,
                autocapture: false,
                capture_pageview: false,
                capture_pageleave: false,
                disable_surveys: true,
                disable_compression: true,
                session_recording: { compress_events: false },
                ...(eager === undefined ? {} : { __preview_eager_load_replay: eager }),
            }
            posthog.init('replay-local-test', config)
        }, combination.eager)
        await expect.poll(() => loadedScripts).toEqual([combination.script])
        await page.locator('#input').fill('private input')
        await page.locator('#button').click()
        await expect.poll(() => snapshots.length, { timeout: 10000 }).toBeGreaterThan(0)
        const identity = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog!
            return { oldSession: ph.get_session_id(), oldDistinctId: ph.get_distinct_id() }
        })
        const initial = snapshots.splice(0)
        const initialRrweb = initial.flatMap((event) => event.properties.$snapshot_data)
        expect(initialRrweb.map((event) => event.type)).toEqual(expect.arrayContaining([4, 2, 3]))
        expect(JSON.stringify(initialRrweb)).not.toContain('private input')
        for (const event of initial) {
            expect(event.properties.$session_id).toBe(identity.oldSession)
            expect(event.properties.distinct_id).toBe(identity.oldDistinctId)
        }

        await page.locator('#button').click()
        const newSession = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog!
            ph.reset()
            ph.identify('identified-local-user')
            return ph.get_session_id()
        })
        expect(newSession).not.toBe(identity.oldSession)
        await page.locator('#button').click()
        await page.locator('#button').click()
        await page.evaluate(() => {
            window.dispatchEvent(new Event('pagehide'))
            window.dispatchEvent(new Event('beforeunload'))
        })
        // Historical cores can stop replay at reset. Observe their bounded unload outcome rather than
        // requiring modern reset behavior; compare the same core against both recorder artifacts below.
        await page.waitForTimeout(500)
        const oldTail = snapshots.filter((event) => event.properties.$session_id === identity.oldSession)
        const newRecording = snapshots.filter((event) => event.properties.$session_id === newSession)
        const newTypes = newRecording.flatMap((event) => event.properties.$snapshot_data.map((data: any) => data.type))
        expect(unexpectedRequests).toEqual([])
        expect(pageErrors).toEqual([])
        return {
            loadedScripts,
            initialHasOrdinaryUrl: initial.some((event) => '$current_url' in event.properties),
            oldTailIdentities: Array.from(
                new Set(
                    oldTail.map((event) =>
                        event.properties.distinct_id === identity.oldDistinctId
                            ? 'original'
                            : event.properties.distinct_id === 'identified-local-user'
                              ? 'identified'
                              : 'other'
                    )
                )
            ).sort(),
            hasNewRecording: newRecording.length > 0,
            newIdentityMatches: newRecording.every((event) => event.properties.distinct_id === 'identified-local-user'),
            newRecordingHasPlayablePrefix: newTypes.includes(4) && newTypes.includes(2),
            maskedAfterReset: !JSON.stringify(snapshots).includes('private input'),
        }
    } finally {
        await context.close()
    }
}

// These releases cover both sides of SessionIdManager.on's introduction, the eager/lazy loader
// transition, and a later core from before the shared replay lifecycle.
for (const combination of combinations) {
    test(`released ${combination.version} + ${combination.script} preserves baseline behavior`, async ({
        browser,
        baseURL,
    }, testInfo) => {
        test.skip(!releasedCoreDir || !baselineDist, 'Set REPLAY_RELEASED_CORE_DIR and REPLAY_BASELINE_DIST')
        const baseline = await exerciseCore(browser, baseURL!, combination, baselineDist!)
        const candidate = await exerciseCore(browser, baseURL!, combination, './dist')
        const outcomes = testInfo.outputPath('released-core-outcomes.json')
        await writeFile(outcomes, JSON.stringify({ combination, baseline, candidate }, null, 2))
        await testInfo.attach('released-core-outcomes', { path: outcomes, contentType: 'application/json' })
        expect(candidate).toEqual(baseline)
    })
}

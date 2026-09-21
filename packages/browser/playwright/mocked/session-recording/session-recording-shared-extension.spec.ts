import path from 'path'
import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { waitForSessionRecordingToStart } from '../utils/setup'

const baselineDist = process.env.REPLAY_BASELINE_DIST
const cases = [
    { name: 'default module + independent replay extension', core: 'module.js' },
    { name: 'slim + independent replay extension', core: 'module.slim.js' },
    { name: 'slim.no-external + independent replay extension', core: 'module.slim.no-external.js' },
    {
        name: 'slim.no-external + recorder imported after initialization',
        core: 'module.slim.no-external.js',
        delayedRecorder: true,
    },
    { name: 'new core + legacy recorder', core: 'module.slim.js', legacyRecorder: true },
    { name: 'legacy core + new recorder', core: 'array.js', legacyCore: true },
]

for (const combination of cases) {
    test(combination.name, async ({ page, context }) => {
        test.skip(
            ('legacyCore' in combination || 'legacyRecorder' in combination) && !baselineDist,
            'Set REPLAY_BASELINE_DIST to the pinned baseline dist directory'
        )
        await context.route('**/replay-shared-fixture', (route) =>
            route.fulfill({
                contentType: 'text/html',
                body: '<!doctype html><html><body><input id="input"><button id="button">Interact</button></body></html>',
            })
        )
        await context.route(/\/array\/[^/]+\/config(\?|$)/, (route) =>
            route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify({ sessionRecording: { endpoint: '/ses/' } }),
            })
        )
        await context.route('**/flags/*', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }))
        await context.route('**/replay-artifact/*', (route) => {
            const name = new URL(route.request().url()).pathname.split('/').pop()!
            const legacy =
                (name === 'array.js' && 'legacyCore' in combination) ||
                (name === 'lazy-recorder.js' && 'legacyRecorder' in combination)
            return route.fulfill({
                contentType: 'text/javascript',
                path: path.join(legacy ? baselineDist! : './dist', name),
            })
        })
        await page.goto('/replay-shared-fixture')
        if (!('delayedRecorder' in combination)) {
            await page.addScriptTag({ url: '/replay-artifact/lazy-recorder.js' })
        }
        if ('legacyCore' in combination) {
            await page.addScriptTag({ url: '/replay-artifact/array.js' })
        }
        await page.evaluate(
            async ({ core, legacy }) => {
                const win = window as WindowWithPostHog
                const posthog = legacy ? win.posthog! : (await import('/replay-artifact/' + core)).default
                const extensionClasses = legacy
                    ? undefined
                    : (await import('/replay-artifact/extension-bundles.js')).SessionReplayExtensions
                win.posthog = posthog
                win.capturedEvents = []
                posthog.init('replay-local-test', {
                    api_host: window.location.origin,
                    __extensionClasses: extensionClasses,
                    opt_out_useragent_filter: true,
                    capture_pageview: false,
                    capture_pageleave: false,
                    disable_compression: true,
                    session_recording: { compress_events: false },
                    before_send: (event: any) => {
                        if (event) win.capturedEvents!.push(event)
                        return event
                    },
                })
            },
            { core: combination.core, legacy: 'legacyCore' in combination }
        )
        if ('delayedRecorder' in combination) {
            await page.waitForFunction(
                () => (window as WindowWithPostHog).posthog!.get_property('$session_recording_remote_config')?.enabled
            )
            await page.addScriptTag({ url: '/replay-artifact/posthog-recorder.js' })
            await page.evaluate(() => (window as WindowWithPostHog).posthog!.startSessionRecording())
        }
        await waitForSessionRecordingToStart(page)
        const snapshotRequest = page.waitForRequest('**/ses/*')
        await page.locator('#input').fill('private input')
        await page.locator('#button').click()
        const identities = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog!
            const oldSession = ph.get_session_id()
            const oldDistinctId = ph.get_distinct_id()
            ph.reset()
            ph.identify('identified-local-user')
            return { oldSession, oldDistinctId, newSession: ph.get_session_id() }
        })
        const request = await snapshotRequest
        const body = request.postDataJSON()
        const snapshots = (Array.isArray(body) ? body : [body]).filter((event) => event.event === '$snapshot')
        expect(snapshots.length).toBeGreaterThan(0)
        const snapshot = snapshots[0].properties
        const rrwebEvents = snapshot.$snapshot_data
        expect(rrwebEvents.map((event: any) => event.type)).toEqual(expect.arrayContaining([4, 2, 3]))
        expect(JSON.stringify(rrwebEvents)).not.toContain('private input')
        expect(snapshot.$session_id).toBe(identities.oldSession)
        expect(snapshot.distinct_id).toBe(identities.oldDistinctId)
        expect(snapshot.$window_id).toBeTruthy()
        expect(snapshot.$current_url).toBeUndefined()
        expect(snapshot.$feature_flag_called).toBeUndefined()
        expect(new URL(request.url()).pathname).toBe('/ses/')
        expect(identities.newSession).not.toBe(identities.oldSession)
        const newSnapshotRequest = page.waitForRequest('**/ses/*')
        await page.locator('#button').click()
        await page.locator('#button').click()
        await page.evaluate(() => (window as WindowWithPostHog).posthog!.shutdown())
        const newBody = (await newSnapshotRequest).postDataJSON()
        const newSnapshots = (Array.isArray(newBody) ? newBody : [newBody]).filter(
            (event) => event.event === '$snapshot'
        )
        expect(newSnapshots.length).toBeGreaterThan(0)
        for (const event of newSnapshots) {
            expect(event.properties.$session_id).toBe(identities.newSession)
            expect(event.properties.distinct_id).toBe('identified-local-user')
        }
        expect(
            newSnapshots.flatMap((event) => event.properties.$snapshot_data.map((rrwebEvent: any) => rrwebEvent.type))
        ).toEqual(expect.arrayContaining([4, 2]))
    })
}

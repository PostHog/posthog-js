import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

// Also run with playwright.config.compat.ts: the old core must supply enough persisted
// configuration for the newly loaded recorder to survive a delayed remote response.
test('captures complete masked fetch bodies after a legacy persisted cold start with delayed remote config', async ({
    page,
    context,
}) => {
    const key = '$session_recording_remote_config'
    const options = {
        url: '/playground/cypress/index.html',
        options: {
            persistence: 'localStorage' as const,
            strict_script_versioning: false as const,
            session_recording: { compress_events: false },
        },
        flagsResponseOverrides: {
            sessionRecording: {
                endpoint: '/ses/',
                networkPayloadCapture: { recordBody: true, recordHeaders: true },
            },
            capturePerformance: true,
            autocapture_opt_out: true,
        },
    }
    await page.route(/\/array\/[^/]+\/config\.js(\?|$)/, (route) =>
        route.fulfill({ contentType: 'application/javascript', body: '' })
    )
    await page.route('https://fetch-compat.test/body', (route) =>
        route.fulfill({
            body: 'complete response',
            headers: {
                'Content-Type': 'text/plain',
                Authorization: 'PRIVATE_RESPONSE_HEADER',
                'Access-Control-Expose-Headers': '*',
            },
        })
    )
    await start(options, page, context)
    await waitForSessionRecordingToStart(page)
    await page.evaluate((key) => {
        const ph = (window as WindowWithPostHog).posthog!
        ph.stopSessionRecording()
        const config = { ...ph.get_property(key) }
        delete config.cache_timestamp
        ph.persistence!.register({ [key]: config })
    }, key)
    let releaseConfig!: () => void
    const gate = new Promise<void>((resolve) => {
        releaseConfig = resolve
    })
    await page.route(/\/array\/[^/]+\/config(\?|$)/, async (route) => {
        await gate
        await route.fulfill({ json: options.flagsResponseOverrides })
    })
    try {
        const recorderResponse = page.waitForResponse(/\/static\/(lazy-)?recorder\.js/)
        await start({ ...options, type: 'reload', waitForFlags: false }, page, context)
        await recorderResponse
        await page.waitForFunction(
            () => (window as WindowWithPostHog).posthog?.sessionRecording?.status !== 'lazy_loading'
        )
        expect(
            await page.evaluate(
                (key) => (window as WindowWithPostHog).posthog!.get_property(key)?.networkPayloadCapture?.recordBody,
                key
            )
        ).toBe(true)
        releaseConfig()
        await waitForSessionRecordingToStart(page)
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').fill('activity')
                expect(
                    await page.evaluate(async () => {
                        const response = await fetch('https://fetch-compat.test/body', {
                            method: 'POST',
                            body: 'complete request',
                            headers: { Authorization: 'PRIVATE_REQUEST_HEADER' },
                        })
                        return response.text()
                    })
                ).toEqual('complete response')
            },
        })
        const events = await page.capturedEvents()
        const snapshots = events.filter((e) => e.event === '$snapshot')
        const entries = snapshots
            .flatMap((e) => e.properties.$snapshot_data)
            .filter((e) => e.type === 6 && e.data.plugin === 'rrweb/network@1')
            .flatMap((e) => e.data.payload.requests)
        const request = entries.find((e) => e.name === 'https://fetch-compat.test/body')
        expect(request).toMatchObject({ requestBody: 'complete request', responseBody: 'complete response' })
        expect(JSON.stringify(snapshots)).not.toContain('PRIVATE_')
    } finally {
        releaseConfig()
    }
})

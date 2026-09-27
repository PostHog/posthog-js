import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { CapturedNetworkRequest } from '@/types'
import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

type ScrubbingWindow = WindowWithPostHog & {
    __ph_loaded?: (ph: NonNullable<WindowWithPostHog['posthog']>) => void
    maskingInputs: CapturedNetworkRequest[]
}

test('scrubs bodies before custom masking after a legacy persisted cold start', async ({
    page,
    context,
    staticOverrides,
}, testInfo) => {
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
    await page.addInitScript(() => {
        const win = window as ScrubbingWindow
        win.maskingInputs = []
        win.__ph_loaded = (ph) => {
            ph.set_config({
                session_recording: {
                    ...ph.config.session_recording,
                    maskCapturedNetworkRequestFn: (request) => {
                        if (!request.name.startsWith('https://body-scrubbing.test/')) {
                            return request
                        }
                        win.maskingInputs.push({ ...request })
                        return { ...request, requestBody: `custom:${request.requestBody}` }
                    },
                },
            })
        }
    })
    await page.route(/\/array\/[^/]+\/config\.js(\?|$)/, (route) =>
        route.fulfill({ contentType: 'application/javascript', body: '' })
    )
    await page.route('https://body-scrubbing.test/*', (route) =>
        route.fulfill({
            body: route.request().url().endsWith('/sensitive') ? 'password=PRIVATE_RESPONSE' : 'allowed response',
            headers: { 'Content-Type': 'text/plain' },
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
    let configRequested = false
    await page.route(/\/array\/[^/]+\/config(\?|$)/, async (route) => {
        configRequested = true
        await gate
        await route.fulfill({ json: options.flagsResponseOverrides })
    })
    try {
        const coreResponse = page.waitForResponse(/\/static\/array\.js(\?|$)/)
        const recorderResponse = page.waitForResponse(/\/static\/(lazy-)?recorder\.js(\?|$)/)
        await start({ ...options, type: 'reload', waitForFlags: false }, page, context)
        const core = await coreResponse
        const recorder = await recorderResponse
        const coreFile = staticOverrides['array.js'] ?? 'array.js'
        const coreBytes = await core.body()
        expect(coreBytes.equals(readFileSync(`dist/${coreFile}`))).toBe(true)
        await testInfo.attach('served-assets', {
            contentType: 'application/json',
            body: JSON.stringify({
                compatVersion: process.env.COMPAT_VERSION ?? 'current',
                coreFile,
                coreUrl: core.url(),
                coreSha256: createHash('sha256').update(coreBytes).digest('hex'),
                recorderUrl: recorder.url(),
                recorderSha256: createHash('sha256')
                    .update(await recorder.body())
                    .digest('hex'),
            }),
        })
        await expect.poll(() => configRequested).toBe(true)
        await page.waitForFunction(() => {
            const status = (window as WindowWithPostHog).posthog?.sessionRecording?.status
            return Boolean(status) && status !== 'lazy_loading'
        })
        expect(
            await page.evaluate((key) => {
                const config = (window as WindowWithPostHog).posthog!.get_property(key)
                return { recordBody: config?.networkPayloadCapture?.recordBody, timestamp: config?.cache_timestamp }
            }, key)
        ).toEqual({ recordBody: true, timestamp: undefined })
        releaseConfig()
        await waitForSessionRecordingToStart(page)
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').fill('activity')
                expect(
                    await page.evaluate(async () => {
                        const responses: string[] = []
                        for (const path of ['sensitive', 'allowed']) {
                            const response = await fetch(`https://body-scrubbing.test/${path}`, {
                                method: 'POST',
                                body: path === 'sensitive' ? 'password=PRIVATE_REQUEST' : 'allowed request',
                            })
                            responses.push(await response.text())
                        }
                        return responses
                    })
                ).toEqual(['password=PRIVATE_RESPONSE', 'allowed response'])
            },
        })
        await expect
            .poll(async () =>
                (await page.capturedEvents())
                    .filter((event) => event.event === '$snapshot')
                    .flatMap((event) => event.properties.$snapshot_data)
                    .filter((event) => event.type === 6 && event.data.plugin === 'rrweb/network@1')
                    .flatMap((event) => event.data.payload.requests)
                    .map((request) => request.name)
            )
            .toEqual(
                expect.arrayContaining(['https://body-scrubbing.test/sensitive', 'https://body-scrubbing.test/allowed'])
            )
        const inputs = await page.evaluate(() => (window as ScrubbingWindow).maskingInputs)
        expect(inputs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'https://body-scrubbing.test/sensitive',
                    requestBody: '[SessionRecording] Request body redacted as might contain: password',
                    responseBody: '[SessionRecording] Response body redacted as might contain: password',
                }),
                expect.objectContaining({
                    name: 'https://body-scrubbing.test/allowed',
                    requestBody: 'allowed request',
                    responseBody: 'allowed response',
                }),
            ])
        )
        expect(JSON.stringify(inputs)).not.toContain('PRIVATE_')
        const snapshots = (await page.capturedEvents()).filter((event) => event.event === '$snapshot')
        const requests = snapshots
            .flatMap((event) => event.properties.$snapshot_data)
            .filter((event) => event.type === 6 && event.data.plugin === 'rrweb/network@1')
            .flatMap((event) => event.data.payload.requests)
        expect(requests).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'https://body-scrubbing.test/sensitive',
                    requestBody: 'custom:[SessionRecording] Request body redacted as might contain: password',
                    responseBody: '[SessionRecording] Response body redacted as might contain: password',
                }),
                expect.objectContaining({
                    name: 'https://body-scrubbing.test/allowed',
                    requestBody: 'custom:allowed request',
                    responseBody: 'allowed response',
                }),
            ])
        )
        expect(JSON.stringify(snapshots)).not.toContain('PRIVATE_')
    } finally {
        releaseConfig()
    }
})

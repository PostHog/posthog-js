import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { PostHog } from '@/posthog-core'
import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

type MaskingWindow = WindowWithPostHog & {
    __ph_loaded?: (ph: PostHog) => void
    maskingCalls: { modern: string[]; deprecated: string[] }
}

// Exercise the newly built recorder with both the current and pinned compatibility core.
test('honors modern network masking after a legacy persisted cold start with delayed config', async ({
    page,
    context,
    staticOverrides,
}, testInfo) => {
    const key = '$session_recording_remote_config'
    const allowedURL = 'https://mask-precedence.test/allowed'
    const droppedURL = 'https://mask-precedence.test/private'
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
        const win = window as MaskingWindow
        win.maskingCalls = { modern: [], deprecated: [] }
        win.__ph_loaded = (ph) => {
            ph.config.session_recording.maskCapturedNetworkRequestFn = (request) => {
                win.maskingCalls.modern.push(request.name)
                return request.name === 'https://mask-precedence.test/private' ? undefined : request
            }
            ph.config.session_recording.maskNetworkRequestFn = (request) => {
                win.maskingCalls.deprecated.push(request.url)
                return request
            }
        }
    })
    await page.route(/\/array\/[^/]+\/config\.js(\?|$)/, (route) =>
        route.fulfill({ contentType: 'application/javascript', body: '' })
    )
    await page.route('https://mask-precedence.test/*', (route) =>
        route.fulfill({ body: 'network positive control', contentType: 'text/plain' })
    )
    const coreResponsePromise = page.waitForResponse(/\/static\/array\.js(\?|$)/)
    await start(options, page, context)
    const coreResponse = await coreResponsePromise
    const coreSource = staticOverrides['array.js'] ?? 'array.js'
    expect(coreResponse.headers().source).toBe(coreSource)
    const coreBytes = await coreResponse.body()
    expect(coreBytes.equals(await readFile(`dist/${coreSource}`))).toBe(true)
    if (process.env.COMPAT_VERSION) {
        expect(coreSource).toBe('array.npm-latest.js')
        expect(coreBytes.toString()).toContain(process.env.COMPAT_VERSION)
    }
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
        const recorderResponsePromise = page.waitForResponse(/\/static\/(lazy-)?recorder\.js(\?|$)/)
        await start({ ...options, type: 'reload', waitForFlags: false }, page, context)
        const recorderResponse = await recorderResponsePromise
        const recorderSource = recorderResponse.headers().source
        expect(['recorder.js', 'lazy-recorder.js']).toContain(recorderSource)
        const recorderBytes = await recorderResponse.body()
        expect(recorderBytes.equals(await readFile(`dist/${recorderSource}`))).toBe(true)
        await testInfo.attach('loaded-assets', {
            contentType: 'application/json',
            body: JSON.stringify({
                coreSource,
                version: process.env.COMPAT_VERSION ?? 'current',
                coreSha256: createHash('sha256').update(coreBytes).digest('hex'),
                recorderSource,
                recorderSha256: createHash('sha256').update(recorderBytes).digest('hex'),
            }),
        })
        await expect.poll(() => configRequested).toBe(true)
        await page.waitForFunction(() => {
            const status = (window as WindowWithPostHog).posthog?.sessionRecording?.status
            return status !== undefined && status !== 'lazy_loading'
        })
        expect(
            await page.evaluate((key) => {
                const config = (window as WindowWithPostHog).posthog!.get_property(key)
                return { recordBody: config?.networkPayloadCapture?.recordBody, timestamp: config?.cache_timestamp }
            }, key)
        ).toEqual({ recordBody: true, timestamp: undefined })
        releaseConfig()
        await waitForSessionRecordingToStart(page)
        await page.locator('[data-cy-input]').fill('activity')
        expect(
            await page.evaluate(
                async (urls) => {
                    return Promise.all(urls.map(async (url) => (await fetch(url)).text()))
                },
                [droppedURL, allowedURL]
            )
        ).toEqual(['network positive control', 'network positive control'])
        // Wait for an actual emitted network entry, not just recording startup or a callback.
        await expect
            .poll(async () => {
                const events = await page.capturedEvents()
                return events
                    .filter((event) => event.event === '$snapshot')
                    .flatMap((event) => event.properties.$snapshot_data)
                    .filter((event) => event.type === 6 && event.data.plugin === 'rrweb/network@1')
                    .flatMap((event) => event.data.payload.requests)
                    .filter((request) => request.name === allowedURL)
                    .map((request) => request.responseBody)
            })
            .toContain('network positive control')
        const snapshots = (await page.capturedEvents()).filter((event) => event.event === '$snapshot')
        expect(JSON.stringify(snapshots)).not.toContain(droppedURL)
        const calls = await page.evaluate(() => (window as MaskingWindow).maskingCalls)
        expect(calls.modern).toContain(droppedURL)
        expect(calls.modern).toContain(allowedURL)
        expect(calls.deprecated).toEqual([])
    } finally {
        releaseConfig()
    }
})

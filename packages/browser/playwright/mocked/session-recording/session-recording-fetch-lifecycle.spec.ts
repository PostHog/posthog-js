import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'
import { createServer } from 'http'
import type { AddressInfo } from 'net'

for (const streamNetworkBody of [false, true]) {
    for (const action of ['stop', 'restart', 'opt-out']) {
        test(`does not emit pending fetch capture after ${action}, streaming ${streamNetworkBody}`, async ({
            page,
            context,
        }) => {
            const url = 'https://fetch-lifecycle.test/pending-capture'
            await page.route('https://fetch-lifecycle.test/*', (route) =>
                route.fulfill({ body: 'application response', contentType: 'text/plain' })
            )
            await start(
                {
                    url: '/playground/cypress/index.html',
                    options: { session_recording: { compress_events: false, streamNetworkBody } },
                    flagsResponseOverrides: {
                        sessionRecording: {
                            endpoint: '/ses/',
                            networkPayloadCapture: { recordBody: true, recordHeaders: true },
                        },
                        capturePerformance: true,
                        autocapture_opt_out: true,
                    },
                },
                page,
                context
            )
            await waitForSessionRecordingToStart(page)
            await page.locator('[data-cy-input]').fill('activity')
            await page.evaluate((url) => {
                const win = window as any
                const originalClone = Response.prototype.clone
                let release!: () => void
                const gate = new Promise<void>((resolve) => {
                    release = resolve
                })
                win.releaseCapture = release
                Response.prototype.clone = function () {
                    const clone = originalClone.call(this)
                    if (this.url === url) {
                        win.captureReadStarted = true
                        const text = clone.text.bind(clone)
                        clone.text = () => gate.then(text)
                        const getReader = clone.body!.getReader.bind(clone.body!)
                        clone.body!.getReader = (() => {
                            const reader = getReader()
                            const read = reader.read.bind(reader)
                            reader.read = () => gate.then(read)
                            return reader
                        }) as typeof getReader
                    }
                    return clone
                }
                win.pendingFetch = fetch(url).then((response) => response.text())
                win.restoreClone = () => {
                    Response.prototype.clone = originalClone
                }
            }, url)
            await page.waitForFunction(() => (window as any).captureReadStarted)
            await page.evaluate((action) => {
                const ph = (window as WindowWithPostHog).posthog!
                if (action === 'opt-out') ph.opt_out_capturing()
                else {
                    ph.stopSessionRecording()
                    if (action === 'restart') ph.startSessionRecording()
                }
                ;(window as any).releaseCapture()
                ;(window as any).restoreClone()
            }, action)
            expect(await page.evaluate(() => (window as any).pendingFetch)).toBe('application response')
            if (action === 'restart') {
                await waitForSessionRecordingToStart(page)
                expect(
                    await page.evaluate(async () => (await fetch('https://fetch-lifecycle.test/new-observer')).text())
                ).toBe('application response')
            }
            // Covers the existing resource-timing retry window plus snapshot flush cadence.
            await page.waitForTimeout(4000)
            if (action === 'stop')
                expect(
                    await page.evaluate(() => (window as WindowWithPostHog).posthog!.sessionRecordingStarted())
                ).toBe(false)
            else if (action === 'opt-out')
                expect(
                    await page.evaluate(() => (window as WindowWithPostHog).posthog!.has_opted_out_capturing())
                ).toBe(true)
            const snapshots = (await page.capturedEvents()).filter((event) => event.event === '$snapshot')
            const requests = snapshots
                .flatMap((event) => event.properties.$snapshot_data)
                .filter((event) => event.type === 6 && event.data.plugin === 'rrweb/network@1')
                .flatMap((event) => event.data.payload.requests)
                .filter((request) => !request.isInitial)
            expect(requests.some((request) => request.name === url)).toBe(false)
            if (action === 'restart')
                expect(
                    requests.find((request) => request.name === 'https://fetch-lifecycle.test/new-observer')
                ).toMatchObject({ responseBody: 'application response' })
        })
    }

    test(`preserves AbortError while consuming a real response after headers, streaming ${streamNetworkBody}`, async ({
        page,
        context,
    }) => {
        const server = createServer((_request, response) => {
            response.writeHead(200, {
                'Content-Type': 'text/plain',
                'Content-Length': '4',
                'Access-Control-Allow-Origin': '*',
            })
            response.write('ab')
            // Hold the remainder until the application's AbortController closes the connection.
        })
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/abort-after-headers`
        try {
            await page.addInitScript((url) => {
                const nativeFetch = window.fetch
                window.fetch = (...args) =>
                    nativeFetch(...args).then((response) => {
                        if (response.url === url) (window as any).nativeHeadersSeen = true
                        return response
                    })
            }, url)
            await start(
                {
                    url: '/playground/cypress/index.html',
                    options: { session_recording: { compress_events: false, streamNetworkBody } },
                    flagsResponseOverrides: {
                        sessionRecording: { endpoint: '/ses/', networkPayloadCapture: { recordBody: true } },
                    },
                },
                page,
                context
            )
            await waitForSessionRecordingToStart(page)
            await page.evaluate((url) => {
                const win = window as any
                win.controller = new AbortController()
                win.bodyResult = fetch(url, { signal: win.controller.signal })
                    .then((response) => response.text())
                    .then(
                        () => 'unexpected success',
                        (error) => error.name
                    )
            }, url)
            await page.waitForFunction(() => (window as any).nativeHeadersSeen)
            await page.evaluate(() => (window as any).controller.abort())
            expect(await page.evaluate(() => (window as any).bodyResult)).toBe('AbortError')
        } finally {
            server.closeAllConnections()
            await new Promise<void>((resolve) => server.close(() => resolve()))
        }
    })
}

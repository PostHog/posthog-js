import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'
import { BrowserContext, Page } from '@playwright/test'

// Validates that capturing the canvas at a reduced resolution (session_recording.canvasCapture.
// resolutionScale) does NOT mislabel dimensions: the recorded drawImage stretches the (smaller)
// encoded frame back to the canvas's display size, so playback dimensions/aspect are unchanged -
// only the encoded bytes shrink. Uses a canvas whose backing store (2000x1500) differs from its
// CSS display size (1000x750), i.e. the "is it 1000 or 2000?" case, and drives the real init
// config path (not a private method) via two sequential recordings on the same page.
// The canvas redraws random content each frame, so we assert the byte-size trend
// (half-res frame is meaningfully smaller), not pixel identity between the two runs.

type CanvasFrame = { dw: number; dh: number; base64Len: number }

function startOptionsFor(resolutionScale: number | undefined): Parameters<typeof start>[0] {
    return {
        options: {
            session_recording: {
                compress_events: false,
                captureCanvas: { recordCanvas: true, canvasFps: 8, canvasQuality: 0.6 },
                canvasCapture: resolutionScale === undefined ? undefined : { resolutionScale },
            },
        },
        flagsResponseOverrides: {
            sessionRecording: { endpoint: '/ses/' },
            capturePerformance: true,
            autocapture_opt_out: true,
        },
        url: './playground/cypress/index.html',
    }
}

function latestCanvasFrame(events: any[]): CanvasFrame | undefined {
    const frames: CanvasFrame[] = []
    for (const e of events.filter((ev) => ev.event === '$snapshot')) {
        for (const snap of e.properties?.$snapshot_data || []) {
            // rrweb IncrementalSnapshot (3) with CanvasMutation source (9)
            if (snap.type !== 3 || snap.data?.source !== 9) {
                continue
            }
            const drawImage = (snap.data.commands || []).find((c: any) => c.property === 'drawImage')
            if (!drawImage) {
                continue
            }
            // drawImage args: [serializedImage, dx, dy, dWidth, dHeight]
            const dw = drawImage.args[3]
            const dh = drawImage.args[4]
            const base64 = drawImage.args[0]?.args?.[0]?.data?.[0]?.base64 ?? ''
            frames.push({ dw, dh, base64Len: base64.length })
        }
    }
    return frames[frames.length - 1]
}

async function recordCanvasFrame(
    page: Page,
    context: BrowserContext,
    resolutionScale: number | undefined
): Promise<CanvasFrame | undefined> {
    await page.waitingForNetworkCausedBy({
        urlPatternsToWaitFor: ['**/*recorder.js*'],
        action: async () => {
            await start(startOptionsFor(resolutionScale), page, context)
        },
    })
    await waitForSessionRecordingToStart(page)

    // a canvas whose backing store (2000x1500) is larger than its CSS display size (1000x750)
    await page.evaluate(() => {
        const canvas = document.createElement('canvas')
        canvas.width = 2000
        canvas.height = 1500
        canvas.style.width = '1000px'
        canvas.style.height = '750px'
        document.body.appendChild(canvas)
        const ctx = canvas.getContext('2d')!
        let f = 0
        function draw(): void {
            f++
            ctx.fillStyle = `hsl(${f % 360},80%,50%)`
            ctx.fillRect(0, 0, 2000, 1500)
            for (let i = 0; i < 300; i++) {
                ctx.fillStyle = `rgba(${(i * f) % 255},${(i + f) % 255},${f % 255},0.8)`
                ctx.fillRect((i * 37 + f * 9) % 2000, (i * 53 + f * 7) % 1500, 24, 24)
            }
            requestAnimationFrame(draw)
        }
        draw()
    })

    await page.resetCapturedEvents()
    for (let i = 0; i < 3; i++) {
        await page.locator('[data-cy-input]').type('x')
        await page.waitForTimeout(1000)
    }
    await page.evaluate(() => (window as WindowWithPostHog).posthog?.capture('flush'))
    await page.waitForTimeout(800)

    return latestCanvasFrame((await page.capturedEvents()) || [])
}

test.describe('canvas capture resolution', () => {
    test('downscaling keeps the recorded display size and only shrinks the encoded frame', async ({
        page,
        context,
        browserName,
    }: {
        page: Page
        context: BrowserContext
        browserName: string
    }) => {
        // the canvas FPS-snapshot observer requires OffscreenCanvas, which webkit doesn't support,
        // so no canvas frames are captured there - skip rather than assert on a frame that can't exist.
        test.skip(browserName === 'webkit', 'canvas FPS capture requires OffscreenCanvas (unsupported on webkit)')

        // two sequential recordings on the same page: each start() navigates fresh and re-inits
        // posthog with the given canvasCapture config (the later route registration wins).
        // full resolution (resolutionScale unset -> 1)
        const fullRes = await recordCanvasFrame(page, context, undefined)
        // half resolution via the real init config
        const halfRes = await recordCanvasFrame(page, context, 0.5)

        expect(fullRes).toBeDefined()
        expect(halfRes).toBeDefined()

        // the recorded display size is the canvas's CSS display size (1000x750) and is IDENTICAL
        // whether or not we downscale the capture - we never relabel a 1000px canvas as anything else.
        expect(fullRes!.dw).toBe(1000)
        expect(fullRes!.dh).toBe(750)
        expect(halfRes!.dw).toBe(fullRes!.dw)
        expect(halfRes!.dh).toBe(fullRes!.dh)

        // ...but the encoded frame is meaningfully smaller at half resolution. half scale is a
        // 0.25x pixel area, so bytes should drop well below this loose ceiling - kept loose
        // because webp compression of the random-per-frame content is noisy.
        const MAX_HALF_RES_BYTE_RATIO = 0.7
        expect(halfRes!.base64Len).toBeLessThan(fullRes!.base64Len * MAX_HALF_RES_BYTE_RATIO)
    })
})

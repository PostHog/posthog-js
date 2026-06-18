import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'
import { Page } from '@playwright/test'

// Validates that downscaling canvas capture (varyResolution) does NOT mislabel dimensions:
// the recorded drawImage stretches the (smaller) encoded frame back to the canvas's display
// size, so playback dimensions/aspect are unchanged - only the encoded bytes shrink.
// Uses a canvas whose backing store (2000x1500) differs from its CSS display size (1000x750),
// i.e. the "is it 1000 or 2000?" case.

const startOptions = {
    options: {
        session_recording: {
            compress_events: false,
            captureCanvas: { recordCanvas: true, canvasFps: 8, canvasQuality: 0.6 },
        },
    },
    flagsResponseOverrides: {
        sessionRecording: { endpoint: '/ses/' },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: './playground/cypress/index.html',
}

type CanvasFrame = { dw: number; dh: number; base64Len: number }

async function latestCanvasFrame(page: Page): Promise<CanvasFrame | undefined> {
    const events = (await page.capturedEvents()) || []
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

async function recordCanvasActivity(page: Page, seconds: number): Promise<void> {
    for (let i = 0; i < seconds; i++) {
        await page.locator('[data-cy-input]').type('x')
        await page.waitForTimeout(1000)
    }
    await page.evaluate(() => (window as WindowWithPostHog).posthog?.capture('flush'))
    await page.waitForTimeout(800)
}

test.describe('canvas capture resolution', () => {
    test('downscaling keeps the recorded display size and only shrinks the encoded frame', async ({
        page,
        context,
    }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(startOptions, page, context)
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
            function draw() {
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

        // phase 1: default (full resolution, scale 1)
        await page.resetCapturedEvents()
        await recordCanvasActivity(page, 3)
        const fullRes = await latestCanvasFrame(page)

        // phase 2: downscale live to half resolution
        await page.evaluate(() => {
            ;(window as any).__PosthogExtensions__.rrweb.record.reconfigureCanvas({ scale: 0.5 })
        })
        await page.resetCapturedEvents()
        await recordCanvasActivity(page, 3)
        const halfRes = await latestCanvasFrame(page)

        // eslint-disable-next-line no-console
        console.log('\n=== CANVAS RESOLUTION VALIDATION ===\n' + JSON.stringify({ fullRes, halfRes }, null, 2))

        expect(fullRes).toBeDefined()
        expect(halfRes).toBeDefined()

        // the recorded display size is the canvas's CSS display size (1000x750) and is IDENTICAL
        // before and after downscaling — we do not relabel a 1000px canvas as anything else.
        expect(fullRes!.dw).toBe(1000)
        expect(fullRes!.dh).toBe(750)
        expect(halfRes!.dw).toBe(fullRes!.dw)
        expect(halfRes!.dh).toBe(fullRes!.dh)

        // ...but the encoded frame is meaningfully smaller at half resolution
        expect(halfRes!.base64Len).toBeLessThan(fullRes!.base64Len * 0.7)
    })
})

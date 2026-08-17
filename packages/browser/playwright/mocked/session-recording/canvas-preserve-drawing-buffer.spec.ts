import { expect, test } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'
import { BrowserContext, Page } from '@playwright/test'

// A WebGL context created with preserveDrawingBuffer: false lets the browser discard the drawn
// pixels once the frame has been composited, so canvas capture reads back an empty buffer. rrweb
// forces the attribute on, but only from the moment the lazily loaded recorder bundle patches
// getContext - too late for a renderer that boots with the page, because context attributes are
// fixed at creation time.
//
// This drives that exact ordering: the canvas is created from posthog's `loaded` callback, i.e.
// after init() (where the fix patches getContext) but before remote config has come back and the
// recorder chunk has loaded. It then draws ONCE and never repaints, like an editor or viewer
// sitting idle - a canvas that repaints every frame can land fresh pixels in the buffer by luck,
// which would hide the bug.
//
// The drawn content is a red fill, and the context is left with a transparent clear colour, so
// rrweb's "canvas loaded before rrweb" rescue hack (a bare gl.clear) wipes the canvas rather than
// happening to repaint it red. Only preserving the drawing buffer keeps the red.

const CANVAS_SIZE = { width: 300, height: 200 }

function canvasFrameBase64s(events: any[]): string[] {
    const frames: string[] = []
    for (const e of events.filter((ev) => ev.event === '$snapshot')) {
        for (const snap of e.properties?.$snapshot_data || []) {
            // rrweb IncrementalSnapshot (3) with CanvasMutation source (9)
            if (snap.type !== 3 || snap.data?.source !== 9) {
                continue
            }
            const drawImage = (snap.data.commands || []).find((c: any) => c.property === 'drawImage')
            const base64 = drawImage?.args?.[0]?.args?.[0]?.data?.[0]?.base64
            if (base64) {
                frames.push(base64)
            }
        }
    }
    return frames
}

test.describe('canvas capture of a context created before the recorder loads', () => {
    test('keeps the drawn pixels instead of capturing a blank frame', async ({
        page,
        context,
        browserName,
    }: {
        page: Page
        context: BrowserContext
        browserName: string
    }) => {
        // canvas FPS capture emits no canvas mutations under Playwright's headless WebKit, and
        // WebGL under headless Firefox is unreliable - rrweb's own canvas FPS tests are
        // chromium-only for the same reasons
        test.skip(browserName !== 'chromium', 'canvas FPS capture of WebGL is only reliable under chromium')

        await start(
            {
                options: {
                    session_recording: {
                        compress_events: false,
                        captureCanvas: { recordCanvas: true, canvasFps: 8, canvasQuality: 1 },
                    },
                },
                flagsResponseOverrides: {
                    sessionRecording: { endpoint: '/ses/' },
                    capturePerformance: true,
                    autocapture_opt_out: true,
                },
                url: './playground/cypress/index.html',
                // `loaded` fires at the end of init(), after extensions have initialized and so
                // after the fix has patched getContext, but before remote config has returned and
                // the recorder chunk has loaded. Registering the draw here (rather than driving it
                // from the test) keeps that ordering inside the page, with no round trip to race.
                runBeforePostHogInit: (pg) => {
                    void pg.evaluate(({ width, height }) => {
                        ;(window as any).__ph_loaded = () => {
                            const canvas = document.createElement('canvas')
                            canvas.width = width
                            canvas.height = height
                            canvas.style.width = width + 'px'
                            canvas.style.height = height + 'px'
                            document.body.appendChild(canvas)

                            // deliberately no context attributes: preserveDrawingBuffer defaults to false
                            const gl = canvas.getContext('webgl') as WebGLRenderingContext | null
                            if (!gl) {
                                return
                            }

                            // fill red through a scissored clear, so no shader plumbing is needed
                            gl.enable(gl.SCISSOR_TEST)
                            gl.scissor(0, 0, width, height)
                            gl.clearColor(1, 0, 0, 1)
                            gl.clear(gl.COLOR_BUFFER_BIT)
                            gl.disable(gl.SCISSOR_TEST)

                            // leave the clear colour transparent: a bare gl.clear() now wipes
                            // the canvas rather than happening to repaint it red
                            gl.clearColor(0, 0, 0, 0)
                            gl.finish()
                            ;(window as any).__webglCanvasDrawn = true
                        }
                    }, CANVAS_SIZE)
                },
            },
            page,
            context
        )

        await waitForSessionRecordingToStart(page)

        // the canvas must have been created before the recorder was ready, not by us afterwards
        expect(await page.evaluate(() => (window as any).__webglCanvasDrawn === true)).toBe(true)

        // let the FPS snapshot loop run, then flush. the canvas is never repainted in this window.
        await page.locator('[data-cy-input]').type('x')
        await page.waitForTimeout(1500)
        await page.evaluate(() => (window as any).posthog?.capture('flush'))
        await page.waitForTimeout(800)

        const frames = canvasFrameBase64s((await page.capturedEvents()) || [])

        // without the fix the buffer is discarded, every frame encodes as fully transparent, and
        // the worker's fingerprint dedup drops them all - so there is nothing here at all
        expect(frames.length).toBeGreaterThan(0)

        const centrePixel = await page.evaluate(
            async (base64: string) => {
                const img = new Image()
                img.src = 'data:image/webp;base64,' + base64
                await img.decode()
                const readback = document.createElement('canvas')
                readback.width = img.width
                readback.height = img.height
                const ctx = readback.getContext('2d')!
                ctx.drawImage(img, 0, 0)
                const [r, g, b, a] = ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data
                return { r, g, b, a }
            },
            frames[frames.length - 1]
        )

        // the captured frame is the red the page drew, not a wiped canvas
        expect(centrePixel.a).toBeGreaterThan(200)
        expect(centrePixel.r).toBeGreaterThan(200)
        expect(centrePixel.g).toBeLessThan(60)
        expect(centrePixel.b).toBeLessThan(60)
    })
})

import { createLogger } from '@posthog/browser-common/utils/logger'
import { window } from '@posthog/browser-common/utils/globals'
import { isObject } from '@posthog/core'

const logger = createLogger('[SessionRecording][Canvas]')

const WEBGL_CONTEXT_NAMES = ['webgl', 'webgl2', 'experimental-webgl']

let patched = false

/**
 * Canvas replay reads pixels back out of a canvas some time after the page drew into it. A WebGL
 * context created with `preserveDrawingBuffer: false` - the spec default, and what any
 * performance-minded renderer asks for - lets the browser throw those pixels away as soon as the
 * frame has been composited, so the frames we capture come back blank.
 *
 * The recorder already forces `preserveDrawingBuffer: true` when it patches `getContext`, but it can
 * only do that once the lazily loaded recorder bundle has arrived. Context attributes are fixed at
 * creation time and cannot be changed afterwards, so an app that builds its renderer while the page
 * is loading - WebGL editors, map and 3D canvases, WASM-backed engines - has already created a
 * context we can never capture by the time the recorder patches anything.
 *
 * Patching during `posthog.init()` closes that window. It is deliberately narrow: it only forces the
 * one attribute, and only when canvas recording is already known to be on.
 */
export function forcePreserveDrawingBuffer(): void {
    const canvasPrototype = window?.HTMLCanvasElement?.prototype
    if (patched || !canvasPrototype?.getContext) {
        return
    }
    patched = true

    const originalGetContext = canvasPrototype.getContext
    canvasPrototype.getContext = function (this: HTMLCanvasElement, contextType: string, ...args: any[]) {
        try {
            if (WEBGL_CONTEXT_NAMES.indexOf(contextType) !== -1) {
                if (isObject(args[0])) {
                    args[0].preserveDrawingBuffer = true
                } else {
                    args[0] = { preserveDrawingBuffer: true }
                }
            }
        } catch (e) {
            logger.error('could not force preserveDrawingBuffer', e)
        }

        return originalGetContext.apply(this, [contextType, ...args] as any)
    } as typeof canvasPrototype.getContext
}

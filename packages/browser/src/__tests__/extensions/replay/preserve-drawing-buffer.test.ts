import { forcePreserveDrawingBuffer } from '../../../extensions/replay/preserve-drawing-buffer'

describe('forcePreserveDrawingBuffer', () => {
    let originalGetContext: typeof HTMLCanvasElement.prototype.getContext
    let calls: any[][]

    beforeEach(() => {
        jest.resetModules()
        calls = []
        originalGetContext = HTMLCanvasElement.prototype.getContext
        HTMLCanvasElement.prototype.getContext = function (...args: any[]) {
            calls.push(args)
            return { fake: 'context' } as any
        } as any
    })

    afterEach(() => {
        HTMLCanvasElement.prototype.getContext = originalGetContext
    })

    // the module guards against double patching, so each assertion runs against a fresh import
    const patch = async () => {
        const module = await import('../../../extensions/replay/preserve-drawing-buffer')
        module.forcePreserveDrawingBuffer()
    }

    it('adds preserveDrawingBuffer when webgl is requested without attributes', async () => {
        await patch()

        document.createElement('canvas').getContext('webgl')

        expect(calls).toEqual([['webgl', { preserveDrawingBuffer: true }]])
    })

    it('keeps the caller other attributes when overriding preserveDrawingBuffer', async () => {
        await patch()

        document.createElement('canvas').getContext('webgl2', { antialias: false, preserveDrawingBuffer: false })

        expect(calls).toEqual([['webgl2', { antialias: false, preserveDrawingBuffer: true }]])
    })

    it('leaves non-webgl contexts alone', async () => {
        await patch()

        document.createElement('canvas').getContext('2d')

        expect(calls).toEqual([['2d']])
    })

    it('returns whatever the original getContext returned', async () => {
        await patch()

        expect(document.createElement('canvas').getContext('webgl')).toEqual({ fake: 'context' })
    })

    it('only patches once', async () => {
        forcePreserveDrawingBuffer()
        const patchedOnce = HTMLCanvasElement.prototype.getContext
        forcePreserveDrawingBuffer()

        expect(HTMLCanvasElement.prototype.getContext).toBe(patchedOnce)
    })
})

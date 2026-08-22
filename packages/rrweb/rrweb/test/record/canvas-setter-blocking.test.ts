/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import initCanvas2DMutationObserver from '../../src/record/observers/canvas/2d'
import initCanvasWebGLMutationObserver from '../../src/record/observers/canvas/webgl'

class FakeCanvas {
    readonly nodeType = 1
    readonly ELEMENT_NODE = 1
    readonly tagName = 'CANVAS'

    constructor(private blocked: boolean) {}

    classList = {
        contains: (className: string) => this.blocked && className === 'rr-block',
    }

    closest(selector: string) {
        return this.blocked && selector === '.rr-block' ? this : null
    }

    matches() {
        return false
    }
}

function addNativeLikeSetter(prototype: object, property: string, prototypeValue: object) {
    const values = new WeakMap<object, unknown>()
    Object.defineProperty(prototype, property, {
        configurable: true,
        get(this: object) {
            if (this === prototypeValue) throw new TypeError('Illegal invocation')
            return values.get(this)
        },
        set(this: object, value: unknown) {
            values.set(this, value)
        },
    })
}

const waitForSetterHook = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('canvas setter blocking', () => {
    it('does not record blocked 2D setter fallback mutations', async () => {
        class Fake2DContext {
            constructor(public canvas: FakeCanvas) {}
        }
        addNativeLikeSetter(Fake2DContext.prototype, 'fillStyle', Fake2DContext.prototype)

        const cb = vi.fn()
        const restore = initCanvas2DMutationObserver(
            cb,
            { CanvasRenderingContext2D: Fake2DContext } as never,
            'rr-block',
            null,
            {}
        )

        const blocked = new Fake2DContext(new FakeCanvas(true)) as Fake2DContext & {
            fillStyle: string
        }
        const visible = new Fake2DContext(new FakeCanvas(false)) as Fake2DContext & {
            fillStyle: string
        }
        blocked.fillStyle = 'private-marker'
        visible.fillStyle = 'visible-marker'
        await waitForSetterHook()

        expect(cb).toHaveBeenCalledTimes(1)
        expect(cb.mock.calls[0][1]).toMatchObject({
            property: 'fillStyle',
            args: ['visible-marker'],
            setter: true,
        })
        expect(JSON.stringify(cb.mock.calls)).not.toContain('private-marker')
        restore()
    })

    it('does not record blocked or offscreen WebGL setter fallback mutations', async () => {
        class FakeWebGLContext {
            constructor(public canvas: FakeCanvas | object) {}
        }
        addNativeLikeSetter(FakeWebGLContext.prototype, 'lineWidth', FakeWebGLContext.prototype)

        const cb = vi.fn()
        const restore = initCanvasWebGLMutationObserver(
            cb,
            {
                WebGLRenderingContext: FakeWebGLContext,
                WebGL2RenderingContext: undefined,
            } as never,
            'rr-block',
            null,
            {}
        )

        const blocked = new FakeWebGLContext(new FakeCanvas(true)) as FakeWebGLContext & {
            lineWidth: number
        }
        const visible = new FakeWebGLContext(new FakeCanvas(false)) as FakeWebGLContext & {
            lineWidth: number
        }
        const offscreen = new FakeWebGLContext({}) as FakeWebGLContext & {
            lineWidth: number
        }
        blocked.lineWidth = 11
        visible.lineWidth = 22
        offscreen.lineWidth = 33
        await waitForSetterHook()

        expect(cb).toHaveBeenCalledTimes(1)
        expect(cb.mock.calls[0][1]).toMatchObject({
            property: 'lineWidth',
            args: [22],
            setter: true,
        })
        restore()
    })
})

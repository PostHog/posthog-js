/**
 * @vitest-environment jsdom
 */
import { polyfillWebGLGlobals } from '../utils'
polyfillWebGLGlobals()

import { serializeArg } from '../../src/record/observers/canvas/serialize-args'
import type { DataURLOptions } from '@posthog/rrweb-types'

const createContext = () => {
    const ctx = new WebGL2RenderingContext()
    return ctx
}

const defaultDataURLOptions: DataURLOptions = {}

let context: WebGL2RenderingContext
describe('serializeArg', () => {
    beforeEach(() => {
        context = createContext()
    })
    it('should serialize Float32Array values', async () => {
        const float32Array = new Float32Array([-1, -1, 3, -1, -1, 3])
        const expected = {
            rr_type: 'Float32Array',
            args: [[-1, -1, 3, -1, -1, 3]],
        }
        expect(serializeArg(float32Array, window, context, defaultDataURLOptions)).toStrictEqual(expected)
    })

    it('should serialize Float64Array values', async () => {
        const float64Array = new Float64Array([-1, -1, 3, -1, -1, 3])
        const expected = {
            rr_type: 'Float64Array',
            args: [[-1, -1, 3, -1, -1, 3]],
        }

        expect(serializeArg(float64Array, window, context, defaultDataURLOptions)).toStrictEqual(expected)
    })

    it('should serialize ArrayBuffer values', async () => {
        const arrayBuffer = new Uint8Array([1, 2, 0, 4]).buffer
        const expected = {
            rr_type: 'ArrayBuffer',
            base64: 'AQIABA==',
        }

        expect(serializeArg(arrayBuffer, window, context, defaultDataURLOptions)).toStrictEqual(expected)
    })

    it('should serialize Uint8Array values', async () => {
        const object = new Uint8Array([1, 2, 0, 4])
        const expected = {
            rr_type: 'Uint8Array',
            args: [[1, 2, 0, 4]],
        }

        expect(serializeArg(object, window, context, defaultDataURLOptions)).toStrictEqual(expected)
    })

    it('should serialize DataView values', async () => {
        const dataView = new DataView(new ArrayBuffer(16), 0, 16)
        const expected = {
            rr_type: 'DataView',
            args: [
                {
                    rr_type: 'ArrayBuffer',
                    base64: 'AAAAAAAAAAAAAAAAAAAAAA==',
                },
                0,
                16,
            ],
        }

        expect(serializeArg(dataView, window, context, defaultDataURLOptions)).toStrictEqual(expected)
    })

    it('should leave arrays intact', async () => {
        const array = [1, 2, 3, 4]
        expect(serializeArg(array, window, context, defaultDataURLOptions)).toStrictEqual(array)
    })

    it('should serialize complex objects', async () => {
        const dataView = [new DataView(new ArrayBuffer(16), 0, 16), 5, 6]
        const expected = [
            {
                rr_type: 'DataView',
                args: [
                    {
                        rr_type: 'ArrayBuffer',
                        base64: 'AAAAAAAAAAAAAAAAAAAAAA==',
                    },
                    0,
                    16,
                ],
            },
            5,
            6,
        ]

        expect(serializeArg(dataView, window, context, defaultDataURLOptions)).toStrictEqual(expected)
    })

    it('should serialize arraybuffer contents', async () => {
        const buffer = new Float32Array([1, 2, 3, 4]).buffer
        const expected = {
            rr_type: 'ArrayBuffer',
            base64: 'AACAPwAAAEAAAEBAAACAQA==',
        }

        expect(serializeArg(buffer, window, context, defaultDataURLOptions)).toStrictEqual(expected)
    })

    it('should leave null as-is', async () => {
        expect(serializeArg(null, window, context, defaultDataURLOptions)).toStrictEqual(null)
    })

    it('should support indexed variables', async () => {
        const webGLProgram = new WebGLProgram()
        expect(serializeArg(webGLProgram, window, context, defaultDataURLOptions)).toStrictEqual({
            rr_type: 'WebGLProgram',
            index: 0,
        })
        const webGLProgram2 = new WebGLProgram()
        expect(serializeArg(webGLProgram2, window, context, defaultDataURLOptions)).toStrictEqual({
            rr_type: 'WebGLProgram',
            index: 1,
        })
    })

    it('should support indexed variables grouped by context', async () => {
        const context1 = createContext()
        const webGLProgram1 = new WebGLProgram()
        expect(serializeArg(webGLProgram1, window, context1, defaultDataURLOptions)).toStrictEqual({
            rr_type: 'WebGLProgram',
            index: 0,
        })
        const context2 = createContext()
        const webGLProgram2 = new WebGLProgram()
        expect(serializeArg(webGLProgram2, window, context2, defaultDataURLOptions)).toStrictEqual({
            rr_type: 'WebGLProgram',
            index: 0,
        })
    })

    it('should support HTMLImageElements', async () => {
        const image = new Image()
        image.src = 'http://example.com/image.png'
        expect(serializeArg(image, window, context, defaultDataURLOptions)).toStrictEqual({
            rr_type: 'HTMLImageElement',
            src: 'http://example.com/image.png',
        })
    })

    it('should support HTMLCanvasElements saved to image', async () => {
        const canvas = document.createElement('canvas')
        // polyfill canvas.toDataURL as it doesn't exist in jsdom
        canvas.toDataURL = () => 'data:image/png;base64,...'
        expect(serializeArg(canvas, window, context, defaultDataURLOptions)).toMatchObject({
            rr_type: 'HTMLImageElement',
            src: 'data:image/png;base64,...',
        })
    })

    it('should serialize ImageData', async () => {
        const arr = new Uint8ClampedArray(40000)

        // Iterate through every pixel
        for (let i = 0; i < arr.length; i += 4) {
            arr[i + 0] = 0 // R value
            arr[i + 1] = 190 // G value
            arr[i + 2] = 0 // B value
            arr[i + 3] = 255 // A value
        }

        // Initialize a new ImageData object
        let imageData = new ImageData(arr, 200, 50)

        const contents = Array.from(arr)
        expect(serializeArg(imageData, window, context, defaultDataURLOptions)).toStrictEqual({
            rr_type: 'ImageData',
            args: [
                {
                    rr_type: 'Uint8ClampedArray',
                    args: [contents],
                },
                200,
                50,
            ],
        })
    })

    // we do not yet support async serializing which is needed to call Blob.arrayBuffer()
    it.skip('should serialize a blob', async () => {
        const arrayBuffer = new Uint8Array([1, 2, 0, 4]).buffer
        const blob = new Blob([arrayBuffer], { type: 'image/png' })
        const expected = {
            rr_type: 'ArrayBuffer',
            base64: 'AQIABA==',
        }

        expect(await serializeArg(blob, window, context, defaultDataURLOptions)).toStrictEqual({
            rr_type: 'Blob',
            args: [expected, { type: 'image/png' }],
        })
    })
})

describe('serializeArg with dataURLOptions', () => {
    beforeEach(() => {
        context = createContext()
    })

    describe.each([
        { type: 'image/jpeg', quality: 0.8, description: 'JPEG at 80% quality' },
        { type: 'image/jpeg', quality: 0.5, description: 'JPEG at 50% quality' },
        { type: 'image/webp', quality: 0.8, description: 'WebP at 80% quality' },
        { type: 'image/webp', quality: 0.5, description: 'WebP at 50% quality' },
        { type: 'image/png', quality: undefined, description: 'PNG (lossless)' },
    ])('HTMLCanvasElement with $description', ({ type, quality, description }) => {
        it(`should serialize with ${description}`, () => {
            const canvas = document.createElement('canvas')
            let capturedType: string | undefined
            let capturedQuality: number | undefined

            canvas.toDataURL = (t?: string, q?: number) => {
                capturedType = t
                capturedQuality = q
                return `data:${t || 'image/png'};base64,...`
            }

            const dataURLOptions: DataURLOptions = { type, quality }
            const result = serializeArg(canvas, window, context, dataURLOptions)

            expect(result).toMatchObject({
                rr_type: 'HTMLImageElement',
                src: `data:${type || 'image/png'};base64,...`,
            })
            expect(capturedType).toBe(type)
            expect(capturedQuality).toBe(quality)
        })
    })

    it('should serialize HTMLCanvasElement with empty dataURLOptions', () => {
        const canvas = document.createElement('canvas')
        let capturedType: string | undefined
        let capturedQuality: number | undefined

        canvas.toDataURL = (t?: string, q?: number) => {
            capturedType = t
            capturedQuality = q
            return 'data:image/png;base64,...'
        }

        const result = serializeArg(canvas, window, context, {})

        expect(result).toMatchObject({
            rr_type: 'HTMLImageElement',
            src: 'data:image/png;base64,...',
        })
        expect(capturedType).toBeUndefined()
        expect(capturedQuality).toBeUndefined()
    })

    it('should serialize nested canvas elements in arrays with quality', () => {
        const canvas1 = document.createElement('canvas')
        const canvas2 = document.createElement('canvas')

        canvas1.toDataURL = (t?: string, q?: number) => `data:${t};base64,canvas1`
        canvas2.toDataURL = (t?: string, q?: number) => `data:${t};base64,canvas2`

        const dataURLOptions: DataURLOptions = { type: 'image/jpeg', quality: 0.6 }
        const result = serializeArg([canvas1, canvas2], window, context, dataURLOptions)

        expect(result).toEqual([
            { rr_type: 'HTMLImageElement', src: 'data:image/jpeg;base64,canvas1' },
            { rr_type: 'HTMLImageElement', src: 'data:image/jpeg;base64,canvas2' },
        ])
    })

    it('should serialize ImageData with nested canvas in complex structure', () => {
        const canvas = document.createElement('canvas')
        canvas.toDataURL = (t?: string, q?: number) => `data:${t};base64,test`

        const complexData = {
            canvas,
            array: [1, 2, canvas],
        }

        const dataURLOptions: DataURLOptions = { type: 'image/webp', quality: 0.7 }
        const result = serializeArg(complexData, window, context, dataURLOptions)

        expect(result).toMatchObject({
            rr_type: 'Object',
            index: 0,
        })
    })
})

// @vitest-environment jsdom
import { record } from '@posthog/rrweb-record'
import { setup, shutdownClients, started } from './session-recording-helpers'

vi.mock('@posthog/rrweb-record', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@posthog/rrweb-record')>()
    return { ...actual, record: Object.assign(vi.fn(actual.record), actual.record) }
})

const recordOptions = () => vi.mocked(record).mock.calls.at(-1)?.[0]

afterEach(async () => {
    await shutdownClients()
    vi.mocked(record).mockClear()
})

describe('canvas recording', () => {
    it('records canvases when the project enables it, as posthog-js does', async () => {
        const { replay } = await setup({ recordCanvas: true, canvasFps: 6, canvasQuality: '0.5' })
        await started(replay)

        expect(recordOptions()).toMatchObject({
            recordCanvas: true,
            sampling: { canvas: 6 },
            dataURLOptions: { type: 'image/webp', quality: 0.5 },
        })
    })

    it('defaults to 4 fps and 0.4 quality and clamps out-of-range settings', async () => {
        const { replay } = await setup({ recordCanvas: true, canvasFps: 30, canvasQuality: null })
        await started(replay)

        expect(recordOptions()).toMatchObject({
            sampling: { canvas: 12 },
            dataURLOptions: { type: 'image/webp', quality: 0.4 },
        })
    })

    it('does not record canvases when the project leaves them off', async () => {
        const { replay } = await setup({})
        await started(replay)

        expect(recordOptions()?.recordCanvas).toBeUndefined()
    })

    it('masks canvas regions with canvasCapture.maskRegionsFn, failing closed when it throws', async () => {
        const canvas = document.createElement('canvas')
        const region = { x: 1, y: 2, width: 3, height: 4 }
        const maskRegionsFn = vi
            .fn()
            .mockReturnValueOnce([region])
            .mockReturnValueOnce(undefined)
            .mockImplementationOnce(() => {
                throw new Error('provider failed')
            })
        const canvasCapture = { maskRegionsFn }
        const pending = setup({ recordCanvas: true }, { canvasCapture })
        // options are snapshotted when the extension is created, before recording starts
        canvasCapture.maskRegionsFn = vi.fn()
        const { replay } = await pending
        await started(replay)

        const masking = recordOptions()?.canvasMasking
        expect(masking?.configured?.()).toBe(true)
        expect(masking?.regionsFn?.(canvas)).toEqual([region])
        expect(masking?.regionsFn?.(canvas)).toBeNull()
        expect(masking?.regionsFn?.(canvas)).toBeNull()
        expect(maskRegionsFn).toHaveBeenCalledWith(canvas)
    })

    it('does not mask canvases without canvasCapture.maskRegionsFn', async () => {
        const { replay } = await setup({ recordCanvas: true })
        await started(replay)

        expect(recordOptions()?.canvasMasking).toBeUndefined()
    })
})

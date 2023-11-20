import { RequestQueue } from '../request-queue'
import { CaptureOptions, Properties, XHROptions } from '../types'

const EPOCH = 1_600_000_000

describe('RequestQueue', () => {
    let handlePollRequest: (url: string, data: Properties, options?: XHROptions) => void
    let queue: RequestQueue

    beforeEach(() => {
        handlePollRequest = jest.fn()
        queue = new RequestQueue(handlePollRequest)
        jest.useFakeTimers()

        jest.spyOn(queue, 'getTime').mockReturnValue(EPOCH)
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    it('handles poll after enqueueing requests', () => {
        queue.enqueue('/e', { event: 'foo', timestamp: EPOCH - 3000 }, { transport: 'XHR' })
        queue.enqueue('/identify', { event: '$identify', timestamp: EPOCH - 2000 }, {})
        queue.enqueue('/e', { event: 'bar', timestamp: EPOCH - 1000 }, {})
        queue.enqueue('/e', { event: 'zeta', timestamp: EPOCH }, {
            _batchKey: 'sessionRecording',
        } as CaptureOptions as XHROptions)

        queue.poll()

        expect(handlePollRequest).toHaveBeenCalledTimes(0)

        jest.runOnlyPendingTimers()

        expect(handlePollRequest).toHaveBeenCalledTimes(3)
        expect(jest.mocked(handlePollRequest).mock.calls).toEqual([
            [
                '/e',
                [
                    { event: 'foo', offset: 3000 },
                    { event: 'bar', offset: 1000 },
                ],
                { transport: 'XHR' },
            ],
            ['/identify', [{ event: '$identify', offset: 2000 }], {}],
            [
                '/e',
                [{ event: 'zeta', offset: 0 }],
                {
                    _batchKey: 'sessionRecording',
                },
            ],
        ])
    })

    it('clears polling flag after 4 empty iterations', () => {
        queue.enqueue('/e', { event: 'foo', timestamp: EPOCH - 3000 }, {})

        for (let i = 0; i < 5; i++) {
            queue.poll()
            jest.runOnlyPendingTimers()

            expect(queue.isPolling).toEqual(true)
        }

        queue.poll()
        jest.runOnlyPendingTimers()

        expect(queue.isPolling).toEqual(false)
    })

    it('handles unload', () => {
        queue.enqueue('/s', { recording_payload: 'example' }, {})
        queue.enqueue('/e', { event: 'foo', timestamp: 1_610_000_000 }, {})
        queue.enqueue('/identify', { event: '$identify', timestamp: 1_620_000_000 }, {})
        queue.enqueue('/e', { event: 'bar', timestamp: 1_630_000_000 }, {})

        queue.unload()

        expect(handlePollRequest).toHaveBeenCalledTimes(3)
        expect(handlePollRequest).toHaveBeenNthCalledWith(
            1,
            '/e',
            [
                { event: 'foo', timestamp: 1_610_000_000 },
                { event: 'bar', timestamp: 1_630_000_000 },
            ],
            { transport: 'sendBeacon' }
        )
        expect(handlePollRequest).toHaveBeenNthCalledWith(2, '/s', [{ recording_payload: 'example' }], {
            transport: 'sendBeacon',
        })
        expect(handlePollRequest).toHaveBeenNthCalledWith(
            3,
            '/identify',
            [{ event: '$identify', timestamp: 1_620_000_000 }],
            { transport: 'sendBeacon' }
        )
    })

    it('handles unload with batchKeys', () => {
        queue.enqueue('/e', { event: 'foo', timestamp: 1_610_000_000 }, { transport: 'XHR' })
        queue.enqueue('/identify', { event: '$identify', timestamp: 1_620_000_000 }, {})
        queue.enqueue('/e', { event: 'bar', timestamp: 1_630_000_000 }, {})
        queue.enqueue('/e', { event: 'zeta', timestamp: 1_640_000_000 }, {
            _batchKey: 'sessionRecording',
        } as CaptureOptions as XHROptions)

        queue.unload()

        expect(handlePollRequest).toHaveBeenCalledTimes(3)
        expect(handlePollRequest).toHaveBeenCalledWith(
            '/e',
            [
                { event: 'foo', timestamp: 1_610_000_000 },
                { event: 'bar', timestamp: 1_630_000_000 },
            ],
            { transport: 'sendBeacon' }
        )
        expect(handlePollRequest).toHaveBeenCalledWith(
            '/identify',
            [{ event: '$identify', timestamp: 1_620_000_000 }],
            { transport: 'sendBeacon' }
        )
        expect(handlePollRequest).toHaveBeenCalledWith('/e', [{ event: 'zeta', timestamp: 1_640_000_000 }], {
            _batchKey: 'sessionRecording',
            transport: 'sendBeacon',
        })
    })
})

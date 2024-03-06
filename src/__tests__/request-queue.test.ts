import { RequestQueue } from '../request-queue'
import { CaptureOptions, Properties, QueuedRequestOptions } from '../types'

const EPOCH = 1_600_000_000

describe('RequestQueue', () => {
    let sendRequest: (options: QueuedRequestOptions) => void
    let queue: RequestQueue

    beforeEach(() => {
        sendRequest = jest.fn()
        queue = new RequestQueue(sendRequest)
        jest.useFakeTimers()

        jest.setSystemTime(EPOCH)
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    it('handles poll after enqueueing requests', () => {
        queue.enqueue({
            data: { event: 'foo', timestamp: EPOCH - 3000 },
            transport: 'XHR',
            url: '/e',
        })
        queue.enqueue({
            data: { event: '$identify', timestamp: EPOCH - 2000 },
            url: '/identify',
        })
        queue.enqueue({
            data: { event: 'bar', timestamp: EPOCH - 1000 },
            url: '/e',
        })
        queue.enqueue({
            data: { event: 'zeta', timestamp: EPOCH },
            url: '/e',
            batchKey: 'sessionRecording',
        })

        queue.enable()

        expect(sendRequest).toHaveBeenCalledTimes(0)

        jest.runOnlyPendingTimers()

        expect(sendRequest).toHaveBeenCalledTimes(3)
        expect(jest.mocked(sendRequest).mock.calls).toEqual([
            [
                {
                    url: '/e',
                    data: [
                        { event: 'foo', offset: 3000 },
                        { event: 'bar', offset: 1000 },
                    ],
                    transport: 'XHR',
                },
            ],
            [
                {
                    url: '/identify',
                    data: [{ event: '$identify', offset: 2000 }],
                },
            ],
            [
                {
                    url: '/e',
                    data: [{ event: 'zeta', offset: 0 }],
                    batchKey: 'sessionRecording',
                },
            ],
        ])
    })

    it('handles unload', () => {
        queue.enqueue({ url: '/s', data: { recording_payload: 'example' } })
        queue.enqueue({ url: '/e', data: { event: 'foo', timestamp: 1_610_000_000 } })
        queue.enqueue({ url: '/identify', data: { event: '$identify', timestamp: 1_620_000_000 } })
        queue.enqueue({ url: '/e', data: { event: 'bar', timestamp: 1_630_000_000 } })
        queue.unload()

        expect(sendRequest).toHaveBeenCalledTimes(3)
        console.log(jest.mocked(sendRequest).mock.calls)
        expect(sendRequest).toHaveBeenNthCalledWith(1, {
            url: '/e',
            data: [
                { event: 'foo', timestamp: 1_610_000_000 },
                { event: 'bar', timestamp: 1_630_000_000 },
            ],
            transport: 'sendBeacon',
        })

        expect(sendRequest).toHaveBeenNthCalledWith(2, {
            url: '/s',
            data: [{ recording_payload: 'example' }],
            transport: 'sendBeacon',
        })
        expect(sendRequest).toHaveBeenNthCalledWith(3, {
            url: '/identify',
            data: [{ event: '$identify', timestamp: 1_620_000_000 }],
            transport: 'sendBeacon',
        })
    })

    it('handles unload with batchKeys', () => {
        queue.enqueue({ url: '/e', data: { event: 'foo', timestamp: 1_610_000_000 }, transport: 'XHR' })
        queue.enqueue({ url: '/identify', data: { event: '$identify', timestamp: 1_620_000_000 } })
        queue.enqueue({ url: '/e', data: { event: 'bar', timestamp: 1_630_000_000 } })
        queue.enqueue({ url: '/e', data: { event: 'zeta', timestamp: 1_640_000_000 }, batchKey: 'sessionRecording' })

        queue.unload()

        expect(sendRequest).toHaveBeenCalledTimes(3)

        expect(sendRequest).toHaveBeenNthCalledWith(1, {
            data: [
                { event: 'foo', timestamp: 1610000000 },
                { event: 'bar', timestamp: 1630000000 },
            ],
            transport: 'sendBeacon',
            url: '/e',
        })
        expect(sendRequest).toHaveBeenNthCalledWith(2, {
            batchKey: 'sessionRecording',
            data: [{ event: 'zeta', timestamp: 1640000000 }],
            transport: 'sendBeacon',
            url: '/e',
        })
        expect(sendRequest).toHaveBeenNthCalledWith(3, {
            data: [{ event: '$identify', timestamp: 1620000000 }],
            transport: 'sendBeacon',
            url: '/identify',
        })
    })
})

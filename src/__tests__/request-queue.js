import { CaptureMetrics } from '../capture-metrics'
import { RequestQueue } from '../request-queue'

const EPOCH = 1_600_000_000

describe('RequestQueue', () => {
    given('queue', () => new RequestQueue(given.captureMetrics, given.handlePollRequest))
    given('handlePollRequest', () => jest.fn())
    given('captureMetrics', () => new CaptureMetrics(true))

    beforeEach(() => {
        jest.useFakeTimers()

        jest.spyOn(given.queue, 'getTime').mockReturnValue(EPOCH)
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    it('handles poll after enqueueing requests', () => {
        given.queue.enqueue('/e', { event: 'foo', timestamp: EPOCH - 3000 }, { transport: 'XHR' })
        given.queue.enqueue('/identify', { event: '$identify', timestamp: EPOCH - 2000 })
        given.queue.enqueue('/e', { event: 'bar', timestamp: EPOCH - 1000 })
        given.queue.enqueue('/e', { event: 'zeta', timestamp: EPOCH }, { _batchKey: 'sessionRecording' })

        given.queue.poll()

        expect(given.handlePollRequest).toHaveBeenCalledTimes(0)

        jest.runOnlyPendingTimers()

        expect(given.handlePollRequest).toHaveBeenCalledTimes(3)
        expect(given.handlePollRequest).toHaveBeenCalledWith(
            '/e',
            [
                { event: 'foo', offset: 3000 },
                { event: 'bar', offset: 1000 },
            ],
            { transport: 'XHR' }
        )
        expect(given.handlePollRequest).toHaveBeenCalledWith(
            '/identify',
            [{ event: '$identify', offset: 2000 }],
            undefined
        )
        expect(given.handlePollRequest).toHaveBeenCalledWith('/e', [{ event: 'zeta', offset: 0 }], {
            _batchKey: 'sessionRecording',
        })
    })

    it('clears polling flag after 4 empty iterations', () => {
        given.queue.enqueue('/e', { event: 'foo', timestamp: EPOCH - 3000 })

        for (let i = 0; i < 5; i++) {
            given.queue.poll()
            jest.runOnlyPendingTimers()

            expect(given.queue.isPolling).toEqual(true)
        }

        given.queue.poll()
        jest.runOnlyPendingTimers()

        expect(given.queue.isPolling).toEqual(false)
    })

    it('handles unload', () => {
        given.queue.enqueue('/s', { recording_payload: 'example' })
        given.queue.enqueue('/e', { event: 'foo', timestamp: 1_610_000_000 })
        given.queue.enqueue('/identify', { event: '$identify', timestamp: 1_620_000_000 })
        given.queue.enqueue('/e', { event: 'bar', timestamp: 1_630_000_000 })

        given.queue.unload()

        expect(given.handlePollRequest).toHaveBeenCalledTimes(3)
        expect(given.handlePollRequest).toHaveBeenNthCalledWith(
            1,
            '/e',
            [
                { event: 'foo', timestamp: 1_610_000_000 },
                { event: 'bar', timestamp: 1_630_000_000 },
            ],
            { transport: 'sendBeacon' }
        )
        expect(given.handlePollRequest).toHaveBeenNthCalledWith(2, '/s', [{ recording_payload: 'example' }], {
            transport: 'sendBeacon',
        })
        expect(given.handlePollRequest).toHaveBeenNthCalledWith(
            3,
            '/identify',
            [{ event: '$identify', timestamp: 1_620_000_000 }],
            { transport: 'sendBeacon' }
        )
    })

    it('handles unload with batchKeys', () => {
        given.queue.enqueue('/e', { event: 'foo', timestamp: 1_610_000_000 }, { transport: 'XHR' })
        given.queue.enqueue('/identify', { event: '$identify', timestamp: 1_620_000_000 })
        given.queue.enqueue('/e', { event: 'bar', timestamp: 1_630_000_000 })
        given.queue.enqueue('/e', { event: 'zeta', timestamp: 1_640_000_000 }, { _batchKey: 'sessionRecording' })

        given.queue.unload()

        expect(given.handlePollRequest).toHaveBeenCalledTimes(3)
        expect(given.handlePollRequest).toHaveBeenCalledWith(
            '/e',
            [
                { event: 'foo', timestamp: 1_610_000_000 },
                { event: 'bar', timestamp: 1_630_000_000 },
            ],
            { transport: 'sendBeacon' }
        )
        expect(given.handlePollRequest).toHaveBeenCalledWith(
            '/identify',
            [{ event: '$identify', timestamp: 1_620_000_000 }],
            { transport: 'sendBeacon' }
        )
        expect(given.handlePollRequest).toHaveBeenCalledWith('/e', [{ event: 'zeta', timestamp: 1_640_000_000 }], {
            _batchKey: 'sessionRecording',
            transport: 'sendBeacon',
        })
    })
})

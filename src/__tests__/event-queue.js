import { EventQueue } from '../event-queue'

const EPOCH = 1_600_000_000

describe('EventQueue', () => {
    given('queue', () => new EventQueue(given.handlePollRequest))
    given('handlePollRequest', () => jest.fn())

    beforeEach(() => {
        jest.useFakeTimers()

        jest.spyOn(given.queue, 'getTime').mockReturnValue(EPOCH)
    })

    it('handles poll after enqueueing requests', () => {
        given.queue.enqueue('/e', { event: 'foo', timestamp: EPOCH - 3000 })
        given.queue.enqueue('/identify', { event: '$identify', timestamp: EPOCH - 2000 })
        given.queue.enqueue('/e', { event: 'bar', timestamp: EPOCH - 1000 })

        given.queue.poll()

        expect(given.handlePollRequest).toHaveBeenCalledTimes(0)

        jest.runOnlyPendingTimers()

        expect(given.handlePollRequest).toHaveBeenCalledTimes(2)
        expect(given.handlePollRequest).toHaveBeenCalledWith('/e', [
            { event: 'foo', offset: 3000 },
            { event: 'bar', offset: 1000 },
        ])
        expect(given.handlePollRequest).toHaveBeenCalledWith('/identify', [{ event: '$identify', offset: 2000 }])
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
        given.queue.enqueue('/e', { event: 'foo', timestamp: 1_610_000_000 })
        given.queue.enqueue('/identify', { event: '$identify', timestamp: 1_620_000_000 })
        given.queue.enqueue('/e', { event: 'bar', timestamp: 1_630_000_000 })

        given.queue.unload()

        expect(given.handlePollRequest).toHaveBeenCalledTimes(2)
        expect(given.handlePollRequest).toHaveBeenCalledWith(
            '/e',
            [
                { event: 'foo', timestamp: 1_610_000_000 },
                { event: 'bar', timestamp: 1_630_000_000 },
            ],
            { unload: true }
        )
        expect(given.handlePollRequest).toHaveBeenCalledWith(
            '/identify',
            [{ event: '$identify', timestamp: 1_620_000_000 }],
            { unload: true }
        )
    })
})

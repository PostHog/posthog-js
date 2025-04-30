import { DEFAULT_FLUSH_INTERVAL_MS, RequestQueue } from '../request-queue'
import { QueuedRequestWithOptions } from '../types'
import { createPosthogInstance } from './helpers/posthog-instance'

const EPOCH = 1_600_000_000

describe('RequestQueue', () => {
    describe('setting flush timeout', () => {
        it('can override the flush timeout', () => {
            const queue = new RequestQueue(jest.fn(), { flush_interval_ms: 1000 })
            expect(queue['_flushTimeoutMs']).toEqual(1000)
        })

        it('defaults to 3000 when not configured', () => {
            const queue = new RequestQueue(jest.fn(), {})
            expect(queue['_flushTimeoutMs']).toEqual(DEFAULT_FLUSH_INTERVAL_MS)
        })

        it('defaults to 3000 when no config', () => {
            const queue = new RequestQueue(jest.fn())
            expect(queue['_flushTimeoutMs']).toEqual(DEFAULT_FLUSH_INTERVAL_MS)
        })

        it('cannot set below 250', () => {
            const queue = new RequestQueue(jest.fn(), { flush_interval_ms: 249 })
            expect(queue['_flushTimeoutMs']).toEqual(250)
        })

        it('cannot set above 5000', () => {
            const queue = new RequestQueue(jest.fn(), { flush_interval_ms: 5001 })
            expect(queue['_flushTimeoutMs']).toEqual(5000)
        })

        it('can be passed in from posthog config', async () => {
            const posthog = await createPosthogInstance('token', { request_queue_config: { flush_interval_ms: 1000 } })
            expect(posthog.config.request_queue_config.flush_interval_ms).toEqual(1000)
            expect(posthog['_requestQueue']['_flushTimeoutMs']).toEqual(1000)
        })
    })

    describe('with default config', () => {
        let sendRequest: (options: QueuedRequestWithOptions) => void
        let queue: RequestQueue

        beforeEach(() => {
            sendRequest = jest.fn()
            queue = new RequestQueue(sendRequest, {})
            jest.useFakeTimers()
            jest.setSystemTime(EPOCH - 3000) // Running the timers will add 3 seconds
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
            queue.enqueue({
                url: '/e',
                data: { event: 'zeta', timestamp: 1_640_000_000 },
                batchKey: 'sessionRecording',
            })

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
})

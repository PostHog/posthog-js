import { CaptureMetrics } from '../capture-metrics'

import { _ } from '../utils'

jest.mock('../utils')

describe('CaptureMetrics()', () => {
    given('captureMetrics', () => new CaptureMetrics(given.enabled, given.capture, given.debugEnabled, given.getTime))

    given('enabled', () => true)
    given('debugEnabled', () => false)
    given('capture', () => jest.fn())
    given('getTime', () => jest.fn())

    describe('incr() and decr()', () => {
        it('supports incrementing and decrementing metrics', () => {
            given.captureMetrics.incr('key')
            given.captureMetrics.incr('key2')
            given.captureMetrics.incr('key', 3)
            given.captureMetrics.decr('key')

            expect(given.captureMetrics.metrics).toEqual({ 'phjs-key': 3, 'phjs-key2': 1 })
        })

        it('does nothing when not enabled', () => {
            given('enabled', () => false)

            given.captureMetrics.incr('key')

            expect(given.captureMetrics.metrics).toEqual({})
        })
    })

    describe('tracking requests', () => {
        beforeEach(() => {
            let i = 0
            _.UUID.mockImplementation(() => i++)
        })

        it('handles starting and finishing a request', () => {
            given.getTime.mockReturnValue(5000)
            const id = given.captureMetrics.startRequest({ size: 123 })

            given.getTime.mockReturnValue(5100)
            const payload = given.captureMetrics.finishRequest(id)

            expect(id).toEqual(0)
            expect(payload).toEqual({ size: 123, duration: 100 })
        })

        it('handles marking a request as failed', () => {
            given.captureMetrics.markRequestFailed({ foo: 'bar' })

            expect(given.capture).toHaveBeenCalledWith('$capture_failed_request', { foo: 'bar' })
        })

        it('handles marking all in-flight requests as failed', () => {
            given.getTime.mockReturnValue(5000)
            given.captureMetrics.startRequest({ size: 100 })

            given.getTime.mockReturnValue(5100)
            given.captureMetrics.startRequest({ size: 200 })

            given.getTime.mockReturnValue(5500)

            given.captureMetrics.captureInProgressRequests()

            expect(given.capture).toHaveBeenCalledTimes(2)
            expect(given.capture).toHaveBeenCalledWith('$capture_failed_request', {
                size: 100,
                duration: 500,
                type: 'inflight_at_unload',
            })
            expect(given.capture).toHaveBeenCalledWith('$capture_failed_request', {
                size: 200,
                duration: 400,
                type: 'inflight_at_unload',
            })
        })

        it('does nothing if not enabled', () => {
            given('enabled', () => false)

            given.captureMetrics.startRequest({ size: 100 })
            given.captureMetrics.captureInProgressRequests()
            given.captureMetrics.markRequestFailed({ foo: 'bar' })
            given.captureMetrics.finishRequest(null)
            given.captureMetrics.addDebugMessage('tomato', 'potato')

            expect(given.capture).not.toHaveBeenCalled()
        })

        describe('logging debug messages via metrics', () => {
            it('does nothing if not enabled', () => {
                given('enabled', () => false)
                given('debugEnabled', () => false)

                given.captureMetrics.addDebugMessage('tomato', 'potato')

                expect(given.captureMetrics.metrics).toEqual({})
            })

            it('does nothing if debug is not enabled', () => {
                given('enabled', () => true)
                given('debugEnabled', () => false)

                given.captureMetrics.addDebugMessage('tomato', 'potato')

                expect(given.captureMetrics.metrics).toEqual({})
            })

            it('does something if capture metrics and debug are enabled', () => {
                given('enabled', () => true)
                given('debugEnabled', () => true)

                given.captureMetrics.addDebugMessage('tomato', 'potato')
                given.captureMetrics.addDebugMessage('potato', 'salad')
                given.captureMetrics.addDebugMessage('potato', 'chips')

                expect(given.captureMetrics.metrics).toEqual({
                    'phjs-debug-tomato': ['potato'],
                    'phjs-debug-potato': ['salad', 'chips'],
                })
            })
        })
    })
})

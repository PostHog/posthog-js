import { CaptureMetrics } from '../capture-metrics'

jest.mock('../utils')

describe('CaptureMetrics()', () => {
    given('captureMetrics', () => new CaptureMetrics(given.enabled))

    given('enabled', () => true)

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
})

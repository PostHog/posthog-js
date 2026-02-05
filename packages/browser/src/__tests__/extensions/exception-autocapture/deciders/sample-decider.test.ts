import { isNull } from '@posthog/core'
import { SampleDecider } from '../../../../extensions/exception-autocapture/controls/deciders/sample-decider'
import { DeciderContext } from '../../../../extensions/exception-autocapture/controls/deciders/types'

const createMockContext = (sampleRate: number | null): DeciderContext => ({
    posthog: null as any,
    window: null as any,
    config: !isNull(sampleRate) ? { library: 'web', matchType: 'all', sampleRate } : undefined,
    log: jest.fn(),
})

describe('SampleDecider', () => {
    const getDecider = (sampleRate: number | null) => {
        const decider = new SampleDecider()
        decider.init(createMockContext(sampleRate))
        return decider
    }

    it('returns null when no sample rate is configured', () => {
        const decider = getDecider(null)

        expect(decider.shouldCapture()).toBeNull()
    })

    it('always returns true when sample rate is 1', () => {
        const decider = getDecider(1)

        for (let i = 0; i < 100; i++) {
            expect(decider.shouldCapture()).toBe(true)
        }
    })

    it('always returns false when sample rate is 0', () => {
        const decider = getDecider(0)

        for (let i = 0; i < 100; i++) {
            expect(decider.shouldCapture()).toBe(false)
        }
    })

    it('samples at approximately 50% when sample rate is 0.5', () => {
        const decider = getDecider(0.5)

        const iterations = 1000
        let trueCount = 0

        for (let i = 0; i < iterations; i++) {
            if (decider.shouldCapture()) {
                trueCount++
            }
        }

        expect(Math.abs(trueCount - iterations * 0.5)).toBeLessThanOrEqual(iterations * 0.1)
    })

    it('samples at approximately 10% when sample rate is 0.1', () => {
        const decider = getDecider(0.1)

        const iterations = 1000
        let trueCount = 0

        for (let i = 0; i < iterations; i++) {
            if (decider.shouldCapture()) {
                trueCount++
            }
        }

        expect(Math.abs(trueCount - iterations * 0.1)).toBeLessThanOrEqual(iterations * 0.05)
    })
})

import { SampleTrigger } from '../../../../extensions/exception-autocapture/controls/triggers/sample-trigger'

describe('SampleTrigger', () => {
    const getTrigger = (sampleRate: number | null) => {
        const trigger = new SampleTrigger()
        trigger.init(sampleRate, {
            log: jest.fn(),
        })
        return trigger
    }

    it('returns null when no sample rate is configured', () => {
        const trigger = getTrigger(null)

        expect(trigger.shouldCapture()).toBeNull()
    })

    it('always returns true when sample rate is 1', () => {
        const trigger = getTrigger(1)

        for (let i = 0; i < 100; i++) {
            expect(trigger.shouldCapture()).toBe(true)
        }
    })

    it('always returns false when sample rate is 0', () => {
        const trigger = getTrigger(0)

        for (let i = 0; i < 100; i++) {
            expect(trigger.shouldCapture()).toBe(false)
        }
    })

    it('samples at approximately 50% when sample rate is 0.5', () => {
        const trigger = getTrigger(0.5)

        const iterations = 1000
        let trueCount = 0

        for (let i = 0; i < iterations; i++) {
            if (trigger.shouldCapture()) {
                trueCount++
            }
        }

        expect(Math.abs(trueCount - iterations * 0.5)).toBeLessThanOrEqual(iterations * 0.1)
    })

    it('samples at approximately 10% when sample rate is 0.1', () => {
        const trigger = getTrigger(0.1)

        const iterations = 1000
        let trueCount = 0

        for (let i = 0; i < iterations; i++) {
            if (trigger.shouldCapture()) {
                trueCount++
            }
        }

        expect(Math.abs(trueCount - iterations * 0.1)).toBeLessThanOrEqual(iterations * 0.05)
    })
})

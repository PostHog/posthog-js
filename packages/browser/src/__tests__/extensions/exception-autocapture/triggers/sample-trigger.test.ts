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

    describe('idempotency', () => {
        it('can change sample rate on re-init', () => {
            const trigger = new SampleTrigger()

            // First init with 100% rate
            trigger.init(1, { log: jest.fn() })
            expect(trigger.shouldCapture()).toBe(true)

            // Re-init with 0% rate
            trigger.init(0, { log: jest.fn() })
            expect(trigger.shouldCapture()).toBe(false)

            // Re-init with null (disabled)
            trigger.init(null, { log: jest.fn() })
            expect(trigger.shouldCapture()).toBeNull()
        })

        it('calling init multiple times with same value is safe', () => {
            const trigger = new SampleTrigger()

            trigger.init(1, { log: jest.fn() })
            trigger.init(1, { log: jest.fn() })
            trigger.init(1, { log: jest.fn() })

            expect(trigger.shouldCapture()).toBe(true)
        })
    })
})

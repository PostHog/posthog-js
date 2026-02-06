import { SampleTrigger } from '../../../../extensions/exception-autocapture/controls/triggers/sample-trigger'
import { PersistenceHelper } from '../../../../extensions/exception-autocapture/controls/triggers/persistence'
import type { TriggerOptions } from '../../../../extensions/exception-autocapture/controls/triggers/types'

describe('SampleTrigger', () => {
    const SESSION_ID = 'session-123'
    const OTHER_SESSION_ID = 'session-456'

    const createTrigger = (sampleRate: number | null, persistedData: Record<string, string> = {}) => {
        const storage: Record<string, string> = { ...persistedData }

        const persistence = new PersistenceHelper(
            (key) => storage[key] ?? null,
            (key, value) => {
                storage[key] = value
            }
        ).withPrefix('error_tracking')

        const options: TriggerOptions = {
            posthog: {} as any,
            window: undefined,
            log: jest.fn(),
            persistence,
        }

        const trigger = new SampleTrigger(options, sampleRate)

        return { trigger, storage, options }
    }

    it('returns null when no sample rate is configured', () => {
        const { trigger } = createTrigger(null)

        expect(trigger.matches(SESSION_ID)).toBeNull()
    })

    it('always returns true when sample rate is 1', () => {
        const { trigger } = createTrigger(1)

        for (let i = 0; i < 100; i++) {
            expect(trigger.matches(SESSION_ID)).toBe(true)
        }
    })

    it('always returns false when sample rate is 0', () => {
        const { trigger } = createTrigger(0)

        for (let i = 0; i < 100; i++) {
            expect(trigger.matches(SESSION_ID)).toBe(false)
        }
    })

    it('samples at approximately 50% when sample rate is 0.5', () => {
        const iterations = 100
        let trueCount = 0

        for (let i = 0; i < iterations; i++) {
            const { trigger } = createTrigger(0.5)
            if (trigger.matches(`session-${i}`)) {
                trueCount++
            }
        }

        expect(Math.abs(trueCount - iterations * 0.5)).toBeLessThanOrEqual(iterations * 0.2)
    })

    describe('session stickiness', () => {
        it('returns consistent result for same session', () => {
            const { trigger } = createTrigger(0.5)

            const firstResult = trigger.matches(SESSION_ID)

            // Same session should always return same result
            for (let i = 0; i < 10; i++) {
                expect(trigger.matches(SESSION_ID)).toBe(firstResult)
            }
        })

        it('persists session ID when sampled in', () => {
            const { trigger, storage } = createTrigger(1) // 100% sample rate

            expect(storage['$error_tracking_sample_session']).toBeUndefined()

            trigger.matches(SESSION_ID)

            expect(storage['$error_tracking_sample_session']).toBe(SESSION_ID)
        })

        it('does not persist session ID when sampled out', () => {
            const { trigger, storage } = createTrigger(0) // 0% sample rate

            trigger.matches(SESSION_ID)

            expect(storage['$error_tracking_sample_session']).toBeUndefined()
        })

        it('returns true for same session if previously persisted', () => {
            const { trigger } = createTrigger(0, {
                '$error_tracking_sample_session': SESSION_ID,
            }) // 0% rate but persisted

            // Even with 0% rate, returns true because already persisted
            expect(trigger.matches(SESSION_ID)).toBe(true)
        })

        it('re-samples for different session', () => {
            const { trigger } = createTrigger(0, {
                '$error_tracking_sample_session': OTHER_SESSION_ID,
            }) // Persisted for different session

            // Different session, so will sample again (and fail with 0% rate)
            expect(trigger.matches(SESSION_ID)).toBe(false)
        })
    })
})

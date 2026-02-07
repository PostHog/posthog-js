import { SampleRateTrigger } from '../../../../extensions/triggers/behaviour/sample-rate-trigger'
import { PersistenceHelper } from '../../../../extensions/triggers/behaviour/persistence'
import type { TriggerOptions } from '../../../../extensions/triggers/behaviour/types'

describe('SampleRateTrigger', () => {
    const SESSION_ID = 'session-123'
    const OTHER_SESSION_ID = 'session-456'

    const createTrigger = (sampleRate: number | null, persistedDecision?: { sessionId: string; sampled: boolean }) => {
        const storage: Record<string, unknown> = {}
        if (persistedDecision) {
            storage['$error_tracking_sample_decision'] = persistedDecision
        }

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

        const trigger = new SampleRateTrigger(options, sampleRate)

        return { trigger, storage }
    }

    it('returns null when not configured', () => {
        const { trigger, storage } = createTrigger(null)

        expect(trigger.matches(SESSION_ID)).toBeNull()
        expect(storage['$error_tracking_sample_decision']).toBeUndefined()
    })

    it('returns true and persists when sample rate is 1', () => {
        const { trigger, storage } = createTrigger(1)

        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_sample_decision']).toEqual({ sessionId: SESSION_ID, sampled: true })
    })

    it('returns false and persists when sample rate is 0', () => {
        const { trigger, storage } = createTrigger(0)

        expect(trigger.matches(SESSION_ID)).toBe(false)
        expect(storage['$error_tracking_sample_decision']).toEqual({ sessionId: SESSION_ID, sampled: false })
    })

    it('restores sampled-in from persistence for same session', () => {
        const { trigger, storage } = createTrigger(0, { sessionId: SESSION_ID, sampled: true })

        // Returns true despite 0% rate because already persisted as sampled-in
        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_sample_decision']).toEqual({ sessionId: SESSION_ID, sampled: true })
    })

    it('restores sampled-out from persistence for same session', () => {
        const { trigger, storage } = createTrigger(1, { sessionId: SESSION_ID, sampled: false })

        // Returns false despite 100% rate because already persisted as sampled-out
        expect(trigger.matches(SESSION_ID)).toBe(false)
        expect(storage['$error_tracking_sample_decision']).toEqual({ sessionId: SESSION_ID, sampled: false })
    })

    it('re-samples for different session', () => {
        const { trigger, storage } = createTrigger(0, { sessionId: OTHER_SESSION_ID, sampled: true })

        // Different session, re-samples (and fails with 0% rate)
        expect(trigger.matches(SESSION_ID)).toBe(false)
        expect(storage['$error_tracking_sample_decision']).toEqual({ sessionId: SESSION_ID, sampled: false })
    })

    it('returns same result on repeated calls', () => {
        const { trigger } = createTrigger(0.5)

        const firstResult = trigger.matches(SESSION_ID)

        for (let i = 0; i < 10; i++) {
            expect(trigger.matches(SESSION_ID)).toBe(firstResult)
        }
    })
})

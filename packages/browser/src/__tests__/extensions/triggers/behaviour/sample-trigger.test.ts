import { SampleTrigger } from '../../../../extensions/triggers/behaviour/sample-trigger'
import { PersistenceHelper } from '../../../../extensions/triggers/behaviour/persistence'
import type { TriggerOptions } from '../../../../extensions/triggers/behaviour/types'

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

        return { trigger, storage }
    }

    it('returns null when not configured', () => {
        const { trigger, storage } = createTrigger(null)

        expect(trigger.matches(SESSION_ID)).toBeNull()
        expect(storage['$error_tracking_sample_session_id']).toBeUndefined()
    })

    it('returns true and persists when sample rate is 1', () => {
        const { trigger, storage } = createTrigger(1)

        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_sample_session_id']).toBe(SESSION_ID)
    })

    it('returns false and does not persist when sample rate is 0', () => {
        const { trigger, storage } = createTrigger(0)

        expect(trigger.matches(SESSION_ID)).toBe(false)
        expect(storage['$error_tracking_sample_session_id']).toBeUndefined()
    })

    it('restores from persistence for same session', () => {
        const { trigger, storage } = createTrigger(0, {
            '$error_tracking_sample_session_id': SESSION_ID,
        })

        // Returns true despite 0% rate because already persisted
        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_sample_session_id']).toBe(SESSION_ID)
    })

    it('re-samples for different session', () => {
        const { trigger, storage } = createTrigger(0, {
            '$error_tracking_sample_session_id': OTHER_SESSION_ID,
        })

        // Different session, re-samples (and fails with 0% rate)
        expect(trigger.matches(SESSION_ID)).toBe(false)
        expect(storage['$error_tracking_sample_session_id']).toBe(OTHER_SESSION_ID)
    })

    it('returns same result on repeated calls', () => {
        const { trigger, storage } = createTrigger(0.5)

        const firstResult = trigger.matches(SESSION_ID)

        for (let i = 0; i < 10; i++) {
            expect(trigger.matches(SESSION_ID)).toBe(firstResult)
        }

        if (firstResult) {
            expect(storage['$error_tracking_sample_session_id']).toBe(SESSION_ID)
        } else {
            expect(storage['$error_tracking_sample_session_id']).toBeUndefined()
        }
    })
})

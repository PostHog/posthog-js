import { SampleTrigger } from '../../../../extensions/exception-autocapture/controls/triggers/sample-trigger'

describe('SampleTrigger', () => {
    const SESSION_ID = 'session-123'
    const OTHER_SESSION_ID = 'session-456'

    const getTrigger = (sampleRate: number | null, persistedSessionId: string | null = null) => {
        let storedSessionId: string | null = persistedSessionId

        const trigger = new SampleTrigger()
        trigger.init(sampleRate, {
            log: jest.fn(),
            getPersistedSessionId: () => storedSessionId,
            setPersistedSessionId: (sessionId) => {
                storedSessionId = sessionId
            },
        })

        return { trigger, getStoredSessionId: () => storedSessionId }
    }

    it('returns null when no sample rate is configured', () => {
        const { trigger } = getTrigger(null)

        expect(trigger.matches(SESSION_ID)).toBeNull()
    })

    it('always returns true when sample rate is 1', () => {
        const { trigger } = getTrigger(1)

        for (let i = 0; i < 100; i++) {
            expect(trigger.matches(SESSION_ID)).toBe(true)
        }
    })

    it('always returns false when sample rate is 0', () => {
        const { trigger } = getTrigger(0)

        for (let i = 0; i < 100; i++) {
            expect(trigger.matches(SESSION_ID)).toBe(false)
        }
    })

    it('samples at approximately 50% when sample rate is 0.5', () => {
        const iterations = 100
        let trueCount = 0

        for (let i = 0; i < iterations; i++) {
            const { trigger } = getTrigger(0.5)
            if (trigger.matches(`session-${i}`)) {
                trueCount++
            }
        }

        expect(Math.abs(trueCount - iterations * 0.5)).toBeLessThanOrEqual(iterations * 0.2)
    })

    describe('session stickiness', () => {
        it('returns consistent result for same session', () => {
            const { trigger } = getTrigger(0.5)

            const firstResult = trigger.matches(SESSION_ID)
            
            // Same session should always return same result
            for (let i = 0; i < 10; i++) {
                expect(trigger.matches(SESSION_ID)).toBe(firstResult)
            }
        })

        it('persists session ID when sampled in', () => {
            const { trigger, getStoredSessionId } = getTrigger(1) // 100% sample rate

            expect(getStoredSessionId()).toBeNull()

            trigger.matches(SESSION_ID)

            expect(getStoredSessionId()).toBe(SESSION_ID)
        })

        it('does not persist session ID when sampled out', () => {
            const { trigger, getStoredSessionId } = getTrigger(0) // 0% sample rate

            trigger.matches(SESSION_ID)

            expect(getStoredSessionId()).toBeNull()
        })

        it('returns true for same session if previously persisted', () => {
            const { trigger } = getTrigger(0, SESSION_ID) // 0% rate but persisted

            // Even with 0% rate, returns true because already persisted
            expect(trigger.matches(SESSION_ID)).toBe(true)
        })

        it('re-samples for different session', () => {
            const { trigger } = getTrigger(0, OTHER_SESSION_ID) // Persisted for different session

            // Different session, so will sample again (and fail with 0% rate)
            expect(trigger.matches(SESSION_ID)).toBe(false)
        })
    })

    describe('idempotency', () => {
        it('can change sample rate on re-init', () => {
            const trigger = new SampleTrigger()

            trigger.init(1, {
                log: jest.fn(),
                getPersistedSessionId: () => null,
                setPersistedSessionId: jest.fn(),
            })
            expect(trigger.matches(SESSION_ID)).toBe(true)

            trigger.init(0, {
                log: jest.fn(),
                getPersistedSessionId: () => null,
                setPersistedSessionId: jest.fn(),
            })
            expect(trigger.matches(OTHER_SESSION_ID)).toBe(false)
        })
    })
})

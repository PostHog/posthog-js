import { FlagTrigger, LinkedFlag } from '../../../../extensions/exception-autocapture/controls/triggers/flag-trigger'

type FlagCallback = (flags: string[], variants: Record<string, unknown>) => void

const createMockPosthog = (): {
    posthog: any
    triggerFlags: FlagCallback
    getSubscriptionCount: () => number
} => {
    const callbacks: FlagCallback[] = []

    const posthog = {
        onFeatureFlags: jest.fn((callback: FlagCallback) => {
            callbacks.push(callback)
            return () => {
                const index = callbacks.indexOf(callback)
                if (index > -1) {
                    callbacks.splice(index, 1)
                }
            }
        }),
    }

    const triggerFlags: FlagCallback = (flags, variants) => {
        callbacks.forEach((cb) => cb(flags, variants))
    }

    const getSubscriptionCount = () => callbacks.length

    return { posthog, triggerFlags, getSubscriptionCount }
}

describe('FlagTrigger', () => {
    const SESSION_ID = 'session-123'
    const OTHER_SESSION_ID = 'session-456'

    const getTrigger = (linkedFlag: LinkedFlag | null, persistedSessionId: string | null = null) => {
        const { posthog, triggerFlags, getSubscriptionCount } = createMockPosthog()
        let storedSessionId: string | null = persistedSessionId

        const trigger = new FlagTrigger()
        trigger.init(linkedFlag, {
            posthog: posthog as any,
            log: jest.fn(),
            getPersistedSessionId: () => storedSessionId,
            setPersistedSessionId: (sessionId) => {
                storedSessionId = sessionId
            },
        })

        return { trigger, triggerFlags, posthog, getSubscriptionCount, getStoredSessionId: () => storedSessionId }
    }

    it('returns null when no flag is configured', () => {
        const { trigger } = getTrigger(null)

        expect(trigger.matches(SESSION_ID)).toBeNull()
    })

    it('returns false initially when flag is configured but not yet evaluated', () => {
        const { trigger } = getTrigger({ key: 'my-flag' })

        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('returns true when flag value is true', () => {
        const { trigger, triggerFlags } = getTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': true })

        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('returns false when flag value is false', () => {
        const { trigger, triggerFlags } = getTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': false })

        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('returns true when flag value is a non-empty string variant', () => {
        const { trigger, triggerFlags } = getTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': 'variant-a' })

        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('returns false when flag value is an empty string', () => {
        const { trigger, triggerFlags } = getTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': '' })

        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('ignores flag callbacks that do not contain the linked flag', () => {
        const { trigger, triggerFlags } = getTrigger({ key: 'my-flag' })

        triggerFlags([], { 'other-flag': true })

        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('stays triggered once matched (session sticky)', () => {
        const { trigger, triggerFlags } = getTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': true })
        expect(trigger.matches(SESSION_ID)).toBe(true)

        // Even if flag changes to false, still triggered for this session
        triggerFlags([], { 'my-flag': false })
        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    describe('with specific variant', () => {
        it('returns true only when variant matches', () => {
            const { trigger, triggerFlags } = getTrigger({ key: 'my-flag', variant: 'control' })

            triggerFlags([], { 'my-flag': 'control' })
            expect(trigger.matches(SESSION_ID)).toBe(true)
        })

        it('returns false when variant does not match', () => {
            const { trigger, triggerFlags } = getTrigger({ key: 'my-flag', variant: 'control' })

            triggerFlags([], { 'my-flag': 'test' })
            expect(trigger.matches(SESSION_ID)).toBe(false)
        })

        it('returns false when flag is true but variant is specified', () => {
            const { trigger, triggerFlags } = getTrigger({ key: 'my-flag', variant: 'control' })

            triggerFlags([], { 'my-flag': true })
            expect(trigger.matches(SESSION_ID)).toBe(false)
        })
    })

    describe('session stickiness', () => {
        it('persists session ID when triggered', () => {
            const { trigger, triggerFlags, getStoredSessionId } = getTrigger({ key: 'my-flag' })

            expect(getStoredSessionId()).toBeNull()

            triggerFlags([], { 'my-flag': true })
            trigger.matches(SESSION_ID)

            expect(getStoredSessionId()).toBe(SESSION_ID)
        })

        it('returns true for same session if previously persisted', () => {
            const { trigger } = getTrigger({ key: 'my-flag' }, SESSION_ID)

            expect(trigger.matches(SESSION_ID)).toBe(true)
        })

        it('returns false for different session even if previously persisted', () => {
            const { trigger } = getTrigger({ key: 'my-flag' }, OTHER_SESSION_ID)

            expect(trigger.matches(SESSION_ID)).toBe(false)
        })
    })

    describe('idempotency', () => {
        it('resets state when init is called again', () => {
            const { posthog, triggerFlags } = createMockPosthog()
            const trigger = new FlagTrigger()

            trigger.init({ key: 'my-flag' }, {
                posthog: posthog as any,
                log: jest.fn(),
                getPersistedSessionId: () => null,
                setPersistedSessionId: jest.fn(),
            })
            triggerFlags([], { 'my-flag': true })
            expect(trigger.matches(SESSION_ID)).toBe(true)

            // Re-init should reset state
            trigger.init({ key: 'my-flag' }, {
                posthog: posthog as any,
                log: jest.fn(),
                getPersistedSessionId: () => null,
                setPersistedSessionId: jest.fn(),
            })
            expect(trigger.matches(SESSION_ID)).toBe(false)
        })

        it('unsubscribes old listener when init is called again', () => {
            const { posthog, getSubscriptionCount } = createMockPosthog()
            const trigger = new FlagTrigger()

            trigger.init({ key: 'my-flag' }, {
                posthog: posthog as any,
                log: jest.fn(),
                getPersistedSessionId: () => null,
                setPersistedSessionId: jest.fn(),
            })
            expect(getSubscriptionCount()).toBe(1)

            trigger.init({ key: 'my-flag' }, {
                posthog: posthog as any,
                log: jest.fn(),
                getPersistedSessionId: () => null,
                setPersistedSessionId: jest.fn(),
            })
            expect(getSubscriptionCount()).toBe(1)
        })
    })
})

import { FlagTrigger, LinkedFlag } from '../../../../extensions/triggers/behaviour/flag-trigger'
import { PersistenceHelper } from '../../../../extensions/triggers/behaviour/persistence'
import type { TriggerOptions } from '../../../../extensions/triggers/behaviour/types'

type FlagCallback = (flags: string[], variants: Record<string, unknown>) => void

const createMockPosthog = (sessionId: string) => {
    const callbacks: FlagCallback[] = []

    const posthog = {
        get_session_id: jest.fn(() => sessionId),
        onFeatureFlags: jest.fn((callback: FlagCallback) => {
            callbacks.push(callback)
            return () => {
                const index = callbacks.indexOf(callback)
                if (index >= 0) {
                    callbacks.splice(index, 1)
                }
            }
        }),
    }

    const triggerFlags: FlagCallback = (flags, variants) => {
        callbacks.forEach((cb) => cb(flags, variants))
    }

    const activeListenerCount = () => callbacks.length

    return { posthog, triggerFlags, activeListenerCount }
}

describe('FlagTrigger', () => {
    const SESSION_ID = 'session-123'

    const createTrigger = (linkedFlag: LinkedFlag | null, sessionId: string = SESSION_ID) => {
        const { posthog, triggerFlags, activeListenerCount } = createMockPosthog(sessionId)

        const persistence = new PersistenceHelper(
            () => null,
            () => {}
        ).withPrefix('error_tracking')

        const options: TriggerOptions = {
            posthog: posthog as any,
            window: undefined,
            log: jest.fn(),
            persistence,
        }

        const trigger = new FlagTrigger(options)
        trigger.init(linkedFlag)

        return { trigger, triggerFlags, posthog, activeListenerCount }
    }

    it('returns null when not configured', () => {
        const { trigger } = createTrigger(null)
        expect(trigger.matches(SESSION_ID)).toBeNull()
    })

    it('returns false before flags load', () => {
        const { trigger } = createTrigger({ key: 'my-flag' })
        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('returns true when flag is true', () => {
        const { trigger, triggerFlags } = createTrigger({ key: 'my-flag' })
        triggerFlags([], { 'my-flag': true })
        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('returns false when flag is false', () => {
        const { trigger, triggerFlags } = createTrigger({ key: 'my-flag' })
        triggerFlags([], { 'my-flag': false })
        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('returns true when flag is a non-empty string variant', () => {
        const { trigger, triggerFlags } = createTrigger({ key: 'my-flag' })
        triggerFlags([], { 'my-flag': 'variant-a' })
        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('matches specific variant when configured', () => {
        const { trigger, triggerFlags } = createTrigger({ key: 'my-flag', variant: 'control' })
        triggerFlags([], { 'my-flag': 'control' })
        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('does not match wrong variant', () => {
        const { trigger, triggerFlags } = createTrigger({ key: 'my-flag', variant: 'control' })
        triggerFlags([], { 'my-flag': 'test' })
        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('follows current flag value when flag changes (not sticky)', () => {
        const { trigger, triggerFlags } = createTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': true })
        expect(trigger.matches(SESSION_ID)).toBe(true)

        triggerFlags([], { 'my-flag': false })
        expect(trigger.matches(SESSION_ID)).toBe(false)

        triggerFlags([], { 'my-flag': true })
        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('init is idempotent - only one active listener after multiple calls', () => {
        const { trigger, triggerFlags, activeListenerCount } = createTrigger({ key: 'my-flag' })

        trigger.init({ key: 'my-flag' })
        trigger.init({ key: 'my-flag' })

        expect(activeListenerCount()).toBe(1)

        triggerFlags([], { 'my-flag': true })
        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('re-init switches to new flag', () => {
        const { trigger, triggerFlags } = createTrigger({ key: 'flag-a' })

        triggerFlags([], { 'flag-a': true })
        expect(trigger.matches(SESSION_ID)).toBe(true)

        // Re-init with different flag
        trigger.init({ key: 'flag-b' })

        // Old flag value should not carry over
        expect(trigger.matches(SESSION_ID)).toBe(false)

        // Setting old flag should not affect the trigger (old listener unsubscribed)
        triggerFlags([], { 'flag-a': true })
        expect(trigger.matches(SESSION_ID)).toBe(false)

        // Setting new flag should work
        triggerFlags([], { 'flag-b': true })
        expect(trigger.matches(SESSION_ID)).toBe(true)
    })
})

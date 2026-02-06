import { FlagTrigger, LinkedFlag } from '../../../../extensions/exception-autocapture/controls/triggers/flag-trigger'
import { PersistenceHelper } from '../../../../extensions/exception-autocapture/controls/triggers/persistence'
import type { TriggerOptions } from '../../../../extensions/exception-autocapture/controls/triggers/types'

type FlagCallback = (flags: string[], variants: Record<string, unknown>) => void

const createMockPosthog = (sessionId: string) => {
    const callbacks: FlagCallback[] = []

    const posthog = {
        get_session_id: jest.fn(() => sessionId),
        onFeatureFlags: jest.fn((callback: FlagCallback) => {
            callbacks.push(callback)
            return () => {}
        }),
    }

    const triggerFlags: FlagCallback = (flags, variants) => {
        callbacks.forEach((cb) => cb(flags, variants))
    }

    return { posthog, triggerFlags }
}

describe('FlagTrigger', () => {
    const SESSION_ID = 'session-123'

    const createTrigger = (linkedFlag: LinkedFlag | null, sessionId: string = SESSION_ID) => {
        const { posthog, triggerFlags } = createMockPosthog(sessionId)

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

        const trigger = new FlagTrigger(options, linkedFlag)

        return { trigger, triggerFlags }
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
})

import { FlagTrigger, LinkedFlag } from '../../../../extensions/exception-autocapture/controls/triggers/flag-trigger'
import { PersistenceHelper } from '../../../../extensions/exception-autocapture/controls/triggers/persistence'
import type { TriggerOptions } from '../../../../extensions/exception-autocapture/controls/triggers/types'

type FlagCallback = (flags: string[], variants: Record<string, unknown>) => void

const createMockPosthog = (sessionId: string): {
    posthog: any
    triggerFlags: FlagCallback
} => {
    const callbacks: FlagCallback[] = []

    const posthog = {
        get_session_id: jest.fn(() => sessionId),
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

    return { posthog, triggerFlags }
}

describe('FlagTrigger', () => {
    const SESSION_ID = 'session-123'
    const OTHER_SESSION_ID = 'session-456'

    const createTrigger = (
        linkedFlag: LinkedFlag | null,
        persistedData: Record<string, string> = {},
        sessionId: string = SESSION_ID
    ) => {
        const { posthog, triggerFlags } = createMockPosthog(sessionId)
        const storage: Record<string, string> = { ...persistedData }

        const persistence = new PersistenceHelper(
            (key) => storage[key] ?? null,
            (key, value) => {
                storage[key] = value
            }
        ).withPrefix('error_tracking')

        const options: TriggerOptions = {
            posthog: posthog as any,
            window: undefined,
            log: jest.fn(),
            persistence,
        }

        const trigger = new FlagTrigger(options, linkedFlag)

        return { trigger, triggerFlags, storage, options, posthog }
    }

    it('returns null when no flag is configured', () => {
        const { trigger } = createTrigger(null)

        expect(trigger.matches(SESSION_ID)).toBeNull()
    })

    it('returns false initially when flag is configured but not yet evaluated', () => {
        const { trigger } = createTrigger({ key: 'my-flag' })

        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('returns true when flag value is true', () => {
        const { trigger, triggerFlags } = createTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': true })

        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('returns false when flag value is false', () => {
        const { trigger, triggerFlags } = createTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': false })

        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('returns true when flag value is a non-empty string variant', () => {
        const { trigger, triggerFlags } = createTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': 'variant-a' })

        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    it('returns false when flag value is an empty string', () => {
        const { trigger, triggerFlags } = createTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': '' })

        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('ignores flag callbacks that do not contain the linked flag', () => {
        const { trigger, triggerFlags } = createTrigger({ key: 'my-flag' })

        triggerFlags([], { 'other-flag': true })

        expect(trigger.matches(SESSION_ID)).toBe(false)
    })

    it('stays triggered once matched (session sticky)', () => {
        const { trigger, triggerFlags } = createTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': true })
        expect(trigger.matches(SESSION_ID)).toBe(true)

        // Even if flag changes to false, still triggered for this session
        triggerFlags([], { 'my-flag': false })
        expect(trigger.matches(SESSION_ID)).toBe(true)
    })

    describe('with specific variant', () => {
        it('returns true only when variant matches', () => {
            const { trigger, triggerFlags } = createTrigger({ key: 'my-flag', variant: 'control' })

            triggerFlags([], { 'my-flag': 'control' })
            expect(trigger.matches(SESSION_ID)).toBe(true)
        })

        it('returns false when variant does not match', () => {
            const { trigger, triggerFlags } = createTrigger({ key: 'my-flag', variant: 'control' })

            triggerFlags([], { 'my-flag': 'test' })
            expect(trigger.matches(SESSION_ID)).toBe(false)
        })

        it('returns false when flag is true but variant is specified', () => {
            const { trigger, triggerFlags } = createTrigger({ key: 'my-flag', variant: 'control' })

            triggerFlags([], { 'my-flag': true })
            expect(trigger.matches(SESSION_ID)).toBe(false)
        })
    })

    describe('session stickiness', () => {
        it('persists session ID when flag matches', () => {
            const { triggerFlags, storage } = createTrigger({ key: 'my-flag' })

            expect(storage['$error_tracking_flag_session']).toBeUndefined()

            triggerFlags([], { 'my-flag': true })

            expect(storage['$error_tracking_flag_session']).toBe(SESSION_ID)
        })

        it('returns true for same session if previously persisted', () => {
            const { trigger } = createTrigger({ key: 'my-flag' }, {
                '$error_tracking_flag_session': SESSION_ID,
            })

            expect(trigger.matches(SESSION_ID)).toBe(true)
        })

        it('returns false for different session even if previously persisted', () => {
            const { trigger } = createTrigger({ key: 'my-flag' }, {
                '$error_tracking_flag_session': OTHER_SESSION_ID,
            })

            expect(trigger.matches(SESSION_ID)).toBe(false)
        })
    })
})

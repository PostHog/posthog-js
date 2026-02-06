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

        return { trigger, triggerFlags, storage }
    }

    it('returns null when not configured', () => {
        const { trigger, storage } = createTrigger(null)

        expect(trigger.matches(SESSION_ID)).toBeNull()
        expect(storage['$error_tracking_flag_session_id']).toBeUndefined()
    })

    it('returns false before flags load', () => {
        const { trigger, storage } = createTrigger({ key: 'my-flag' })

        expect(trigger.matches(SESSION_ID)).toBe(false)
        expect(storage['$error_tracking_flag_session_id']).toBeUndefined()
    })

    it('returns true when flag is true', () => {
        const { trigger, triggerFlags, storage } = createTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': true })

        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_flag_session_id']).toBe(SESSION_ID)
    })

    it('returns false when flag is false', () => {
        const { trigger, triggerFlags, storage } = createTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': false })

        expect(trigger.matches(SESSION_ID)).toBe(false)
        expect(storage['$error_tracking_flag_session_id']).toBeUndefined()
    })

    it('returns true when flag is a non-empty string variant', () => {
        const { trigger, triggerFlags, storage } = createTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': 'variant-a' })

        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_flag_session_id']).toBe(SESSION_ID)
    })

    it('matches specific variant when configured', () => {
        const { trigger, triggerFlags, storage } = createTrigger({ key: 'my-flag', variant: 'control' })

        triggerFlags([], { 'my-flag': 'control' })

        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_flag_session_id']).toBe(SESSION_ID)
    })

    it('does not match wrong variant', () => {
        const { trigger, triggerFlags, storage } = createTrigger({ key: 'my-flag', variant: 'control' })

        triggerFlags([], { 'my-flag': 'test' })

        expect(trigger.matches(SESSION_ID)).toBe(false)
        expect(storage['$error_tracking_flag_session_id']).toBeUndefined()
    })

    it('restores from persistence for same session', () => {
        const { trigger, storage } = createTrigger({ key: 'my-flag' }, {
            '$error_tracking_flag_session_id': SESSION_ID,
        })

        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_flag_session_id']).toBe(SESSION_ID)
    })

    it('does not restore for different session', () => {
        const { trigger, storage } = createTrigger({ key: 'my-flag' }, {
            '$error_tracking_flag_session_id': OTHER_SESSION_ID,
        })

        expect(trigger.matches(SESSION_ID)).toBe(false)
        expect(storage['$error_tracking_flag_session_id']).toBe(OTHER_SESSION_ID)
    })

    it('stays triggered even if flag changes', () => {
        const { trigger, triggerFlags, storage } = createTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': true })
        triggerFlags([], { 'my-flag': false })

        expect(trigger.matches(SESSION_ID)).toBe(true)
        expect(storage['$error_tracking_flag_session_id']).toBe(SESSION_ID)
    })
})

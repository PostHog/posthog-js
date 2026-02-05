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
    const getTrigger = (linkedFlag: LinkedFlag | null) => {
        const { posthog, triggerFlags, getSubscriptionCount } = createMockPosthog()

        const trigger = new FlagTrigger()
        trigger.init(linkedFlag, {
            posthog: posthog as any,
            log: jest.fn(),
        })

        return { trigger, triggerFlags, posthog, getSubscriptionCount }
    }

    it('returns null when no flag is configured', () => {
        const { trigger } = getTrigger(null)

        expect(trigger.shouldCapture()).toBeNull()
    })

    it('returns false initially when flag is configured but not yet evaluated', () => {
        const { trigger } = getTrigger({ key: 'my-flag' })

        expect(trigger.shouldCapture()).toBe(false)
    })

    it('returns true when flag value is true', () => {
        const { trigger, triggerFlags } = getTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': true })

        expect(trigger.shouldCapture()).toBe(true)
    })

    it('returns false when flag value is false', () => {
        const { trigger, triggerFlags } = getTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': false })

        expect(trigger.shouldCapture()).toBe(false)
    })

    it('returns true when flag value is a non-empty string variant', () => {
        const { trigger, triggerFlags } = getTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': 'variant-a' })

        expect(trigger.shouldCapture()).toBe(true)
    })

    it('returns false when flag value is an empty string', () => {
        const { trigger, triggerFlags } = getTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': '' })

        expect(trigger.shouldCapture()).toBe(false)
    })

    it('ignores flag callbacks that do not contain the linked flag', () => {
        const { trigger, triggerFlags } = getTrigger({ key: 'my-flag' })

        triggerFlags([], { 'other-flag': true })

        expect(trigger.shouldCapture()).toBe(false)
    })

    it('updates when flag value changes', () => {
        const { trigger, triggerFlags } = getTrigger({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': true })
        expect(trigger.shouldCapture()).toBe(true)

        triggerFlags([], { 'my-flag': false })
        expect(trigger.shouldCapture()).toBe(false)

        triggerFlags([], { 'my-flag': 'enabled' })
        expect(trigger.shouldCapture()).toBe(true)
    })

    describe('with specific variant', () => {
        it('returns true only when variant matches', () => {
            const { trigger, triggerFlags } = getTrigger({ key: 'my-flag', variant: 'control' })

            triggerFlags([], { 'my-flag': 'control' })
            expect(trigger.shouldCapture()).toBe(true)
        })

        it('returns false when variant does not match', () => {
            const { trigger, triggerFlags } = getTrigger({ key: 'my-flag', variant: 'control' })

            triggerFlags([], { 'my-flag': 'test' })
            expect(trigger.shouldCapture()).toBe(false)
        })

        it('returns false when flag is true but variant is specified', () => {
            const { trigger, triggerFlags } = getTrigger({ key: 'my-flag', variant: 'control' })

            triggerFlags([], { 'my-flag': true })
            expect(trigger.shouldCapture()).toBe(false)
        })
    })

    describe('idempotency', () => {
        it('resets state when init is called again', () => {
            const { posthog, triggerFlags, getSubscriptionCount } = createMockPosthog()
            const trigger = new FlagTrigger()

            // First init
            trigger.init({ key: 'my-flag' }, { posthog: posthog as any, log: jest.fn() })
            triggerFlags([], { 'my-flag': true })
            expect(trigger.shouldCapture()).toBe(true)

            // Re-init should reset state
            trigger.init({ key: 'my-flag' }, { posthog: posthog as any, log: jest.fn() })
            expect(trigger.shouldCapture()).toBe(false)
        })

        it('unsubscribes old listener when init is called again', () => {
            const { posthog, getSubscriptionCount } = createMockPosthog()
            const trigger = new FlagTrigger()

            // First init
            trigger.init({ key: 'my-flag' }, { posthog: posthog as any, log: jest.fn() })
            expect(getSubscriptionCount()).toBe(1)

            // Re-init should unsubscribe old and subscribe new
            trigger.init({ key: 'my-flag' }, { posthog: posthog as any, log: jest.fn() })
            expect(getSubscriptionCount()).toBe(1)

            // Third init
            trigger.init({ key: 'my-flag' }, { posthog: posthog as any, log: jest.fn() })
            expect(getSubscriptionCount()).toBe(1)
        })

        it('can change flag on re-init', () => {
            const { posthog, triggerFlags } = createMockPosthog()
            const trigger = new FlagTrigger()

            // First init with one flag
            trigger.init({ key: 'flag-a' }, { posthog: posthog as any, log: jest.fn() })
            triggerFlags([], { 'flag-a': true })
            expect(trigger.shouldCapture()).toBe(true)

            // Re-init with different flag
            trigger.init({ key: 'flag-b' }, { posthog: posthog as any, log: jest.fn() })
            expect(trigger.shouldCapture()).toBe(false)

            // Old flag shouldn't affect new state
            triggerFlags([], { 'flag-a': true })
            expect(trigger.shouldCapture()).toBe(false)

            // New flag should work
            triggerFlags([], { 'flag-b': true })
            expect(trigger.shouldCapture()).toBe(true)
        })
    })
})

import { FlagTrigger, LinkedFlag } from '../../../../extensions/exception-autocapture/controls/triggers/flag-trigger'

type FlagCallback = (flags: string[], variants: Record<string, unknown>) => void

const createMockPosthog = (): { posthog: any; triggerFlags: FlagCallback } => {
    let flagCallback: FlagCallback | null = null

    const posthog = {
        onFeatureFlags: jest.fn((callback: FlagCallback) => {
            flagCallback = callback
        }),
    }

    const triggerFlags: FlagCallback = (flags, variants) => {
        flagCallback?.(flags, variants)
    }

    return { posthog, triggerFlags }
}

describe('FlagTrigger', () => {
    const getTrigger = (linkedFlag: LinkedFlag | null) => {
        const { posthog, triggerFlags } = createMockPosthog()

        const trigger = new FlagTrigger()
        trigger.init(linkedFlag, {
            posthog: posthog as any,
            log: jest.fn(),
        })

        return { trigger, triggerFlags }
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
})

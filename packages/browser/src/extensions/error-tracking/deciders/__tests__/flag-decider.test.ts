import { FlagDecider } from '../flag-decider'
import type { DeciderContext } from '../types'

type FlagCallback = (flags: string[], variants: Record<string, unknown>) => void

const createMockContext = (
    linkedFlag: { key: string; variant?: string | null } | null
): { context: DeciderContext; triggerFlags: FlagCallback } => {
    let flagCallback: FlagCallback | null = null

    const context: DeciderContext = {
        posthog: {
            onFeatureFlags: jest.fn((callback: FlagCallback) => {
                flagCallback = callback
            }),
        } as any,
        window: null as any,
        config: linkedFlag ? { library: 'web', matchType: 'all', linkedFeatureFlag: linkedFlag } : undefined,
        log: jest.fn(),
    }

    const triggerFlags: FlagCallback = (flags, variants) => {
        flagCallback?.(flags, variants)
    }

    return { context, triggerFlags }
}

describe('FlagDecider', () => {
    const getDecider = (linkedFlag: { key: string; variant?: string | null } | null) => {
        const { context, triggerFlags } = createMockContext(linkedFlag)
        const decider = new FlagDecider()
        decider.init(context)
        return { decider, triggerFlags }
    }

    it('returns null when no flag is configured', () => {
        const { decider } = getDecider(null)

        expect(decider.shouldCapture()).toBeNull()
    })

    it('returns false initially when flag is configured but not yet evaluated', () => {
        const { decider } = getDecider({ key: 'my-flag' })

        expect(decider.shouldCapture()).toBe(false)
    })

    it('returns true when flag value is true', () => {
        const { decider, triggerFlags } = getDecider({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': true })

        expect(decider.shouldCapture()).toBe(true)
    })

    it('returns false when flag value is false', () => {
        const { decider, triggerFlags } = getDecider({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': false })

        expect(decider.shouldCapture()).toBe(false)
    })

    it('returns true when flag value is a non-empty string variant', () => {
        const { decider, triggerFlags } = getDecider({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': 'variant-a' })

        expect(decider.shouldCapture()).toBe(true)
    })

    it('returns false when flag value is an empty string', () => {
        const { decider, triggerFlags } = getDecider({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': '' })

        expect(decider.shouldCapture()).toBe(false)
    })

    it('ignores flag callbacks that do not contain the linked flag', () => {
        const { decider, triggerFlags } = getDecider({ key: 'my-flag' })

        triggerFlags([], { 'other-flag': true })

        expect(decider.shouldCapture()).toBe(false)
    })

    it('updates when flag value changes', () => {
        const { decider, triggerFlags } = getDecider({ key: 'my-flag' })

        triggerFlags([], { 'my-flag': true })
        expect(decider.shouldCapture()).toBe(true)

        triggerFlags([], { 'my-flag': false })
        expect(decider.shouldCapture()).toBe(false)

        triggerFlags([], { 'my-flag': 'enabled' })
        expect(decider.shouldCapture()).toBe(true)
    })

    describe('with specific variant', () => {
        it('returns true only when variant matches', () => {
            const { decider, triggerFlags } = getDecider({ key: 'my-flag', variant: 'control' })

            triggerFlags([], { 'my-flag': 'control' })
            expect(decider.shouldCapture()).toBe(true)
        })

        it('returns false when variant does not match', () => {
            const { decider, triggerFlags } = getDecider({ key: 'my-flag', variant: 'control' })

            triggerFlags([], { 'my-flag': 'test' })
            expect(decider.shouldCapture()).toBe(false)
        })

        it('returns false when flag is true but variant is specified', () => {
            const { decider, triggerFlags } = getDecider({ key: 'my-flag', variant: 'control' })

            triggerFlags([], { 'my-flag': true })
            expect(decider.shouldCapture()).toBe(false)
        })
    })
})

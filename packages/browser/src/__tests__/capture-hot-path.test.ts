import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { defaultPostHog } from './helpers/posthog-instance'
import { PERSISTENCE_FACEBOOK_CLICK_ID } from '../constants'
import type { PostHogConfig } from '../types'

// capture() runs inside click handlers, so its work adds directly to Interaction to Next Paint.
// Parsing the whole persistence entry on each capture made INP regress (#5428).
// These tests count the work instead of timing it, so a slow CI runner cannot make them flaky.

const ACTIVE_FEATURE_FLAGS = Array.from({ length: 500 }, (_, index) => `feature-flag-number-${index}`)

const persistenceEntryParses = (parseSpy: { mock: { calls: unknown[][] } }) =>
    parseSpy.mock.calls.filter(([text]) => typeof text === 'string' && text.includes(ACTIVE_FEATURE_FLAGS[0]))

const setupWithManyFlags = (config: Partial<PostHogConfig>) => {
    const token = uuidv7()
    const posthog = defaultPostHog().init(token, config, token)!
    posthog.persistence!.register({ $active_feature_flags: ACTIVE_FEATURE_FLAGS })
    posthog.capture('warm up')
    return { posthog, storageKey: `ph_${token}_posthog` }
}

describe('capture() hot path', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        localStorage.clear()
        sessionStorage.clear()
    })

    it.each<[PostHogConfig['persistence'], boolean, boolean]>([
        ['localStorage+cookie', false, false],
        ['localStorage+cookie', true, false],
        ['localStorage+cookie', false, true],
        ['localStorage+cookie', true, true],
        ['localStorage', false, false],
        ['localStorage', false, true],
        ['sessionStorage', false, false],
        ['sessionStorage', false, true],
    ])(
        'does not parse the persistence entry (persistence: %s, cookieWinsOnConflict: %s, stored $fbc: %s)',
        (persistence, cookieWinsOnConflict, hasStoredFbc) => {
            const { posthog } = setupWithManyFlags({ persistence, cookieWinsOnConflict })
            if (hasStoredFbc) {
                posthog.persistence!.register({
                    [PERSISTENCE_FACEBOOK_CLICK_ID]: { value: 'fb.1.1700000000000.click', delivered: true },
                })
            }

            const parseSpy = vi.spyOn(JSON, 'parse')
            for (let i = 0; i < 5; i++) {
                posthog.capture('$autocapture')
            }

            expect(persistenceEntryParses(parseSpy)).toHaveLength(0)
        }
    )

    it('adopts the $fbc that another tab wrote, then stops parsing the persistence entry', () => {
        const { posthog, storageKey } = setupWithManyFlags({ persistence: 'localStorage' })
        const siblingEntry = JSON.parse(localStorage.getItem(storageKey)!)
        siblingEntry[PERSISTENCE_FACEBOOK_CLICK_ID] = { value: 'fb.1.1700000000000.sibling', delivered: true }
        localStorage.setItem(storageKey, JSON.stringify(siblingEntry))

        posthog.capture('$autocapture')
        const parseSpy = vi.spyOn(JSON, 'parse')
        posthog.capture('$autocapture')

        expect(posthog.persistence!.props[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(
            siblingEntry[PERSISTENCE_FACEBOOK_CLICK_ID]
        )
        expect(persistenceEntryParses(parseSpy)).toHaveLength(0)
    })
})

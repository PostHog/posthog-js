import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { defaultPostHog } from './helpers/posthog-instance'
import { PERSISTENCE_FACEBOOK_BROWSER_ID, PERSISTENCE_FACEBOOK_CLICK_ID } from '../constants'
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

const readEntry = (storageKey: string) => JSON.parse(localStorage.getItem(storageKey)!)

// jsdom does not fire `storage` into the window that wrote, so a sibling tab is simulated by
// writing localStorage and then dispatching the event the browser would deliver to this tab.
const siblingWrites = (storageKey: string, patch: (entry: Record<string, unknown>) => void): string => {
    const entry = readEntry(storageKey)
    patch(entry)
    const newValue = JSON.stringify(entry)
    localStorage.setItem(storageKey, newValue)
    return newValue
}

const siblingStorageEventArrives = (storageKey: string, newValue: string) =>
    window.dispatchEvent(new StorageEvent('storage', { key: storageKey, newValue, storageArea: localStorage }))

const siblingWritesAndEventArrives = (storageKey: string, patch: (entry: Record<string, unknown>) => void) =>
    siblingStorageEventArrives(storageKey, siblingWrites(storageKey, patch))

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

    it.each<PostHogConfig['persistence']>(['localStorage', 'localStorage+cookie'])(
        'adopts the Meta identifiers another tab wrote after the storage event, then stops parsing (persistence: %s)',
        (persistence) => {
            const { posthog, storageKey } = setupWithManyFlags({ persistence })
            const fbc = { value: 'fb.1.1700000000000.sibling', delivered: true }
            const fbp = { value: 'fb.1.1700000000000.1234567890', delivered: false }

            const newValue = siblingWrites(storageKey, (entry) => {
                entry[PERSISTENCE_FACEBOOK_CLICK_ID] = fbc
                entry[PERSISTENCE_FACEBOOK_BROWSER_ID] = fbp
            })
            const parseSpy = vi.spyOn(JSON, 'parse')
            siblingStorageEventArrives(storageKey, newValue)
            expect(persistenceEntryParses(parseSpy)).toHaveLength(1)

            expect(posthog.persistence!.props[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(fbc)
            expect(posthog.persistence!.props[PERSISTENCE_FACEBOOK_BROWSER_ID]).toEqual(fbp)

            parseSpy.mockClear()
            posthog.capture('$autocapture')
            posthog.capture('$autocapture')
            expect(persistenceEntryParses(parseSpy)).toHaveLength(0)
        }
    )

    it('drops a Meta identifier another tab removed', () => {
        const { posthog, storageKey } = setupWithManyFlags({ persistence: 'localStorage' })
        posthog.persistence!.register({
            [PERSISTENCE_FACEBOOK_CLICK_ID]: { value: 'fb.1.1700000000000.local', delivered: true },
        })

        siblingWritesAndEventArrives(storageKey, (entry) => {
            delete entry[PERSISTENCE_FACEBOOK_CLICK_ID]
        })

        expect(posthog.persistence!.props).not.toHaveProperty(PERSISTENCE_FACEBOOK_CLICK_ID)
    })

    it('does not overwrite a sibling write that landed between our last write and our next write', () => {
        const { posthog, storageKey } = setupWithManyFlags({ persistence: 'localStorage' })
        const fbc = { value: 'fb.1.1700000000000.sibling', delivered: true }

        // The sibling's storage event has not been delivered to this tab yet.
        siblingWrites(storageKey, (entry) => (entry[PERSISTENCE_FACEBOOK_CLICK_ID] = fbc))
        expect(posthog.persistence!.props).not.toHaveProperty(PERSISTENCE_FACEBOOK_CLICK_ID)

        posthog.persistence!.register({ unrelated: 'change' })

        expect(posthog.persistence!.props[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(fbc)
        expect(readEntry(storageKey)[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(fbc)
        expect(readEntry(storageKey).unrelated).toEqual('change')
    })

    it('keeps an unflushed local Meta identifier change over a sibling write', () => {
        const { posthog, storageKey } = setupWithManyFlags({
            persistence: 'localStorage',
            persistence_save_debounce_ms: 250,
        })
        const persistence = posthog.persistence!
        persistence.flush()
        const local = { value: 'fb.1.1700000000000.local', delivered: false }
        const sibling = { value: 'fb.1.1700000000000.sibling', delivered: true }

        persistence.register({ [PERSISTENCE_FACEBOOK_CLICK_ID]: local })
        expect(readEntry(storageKey)).not.toHaveProperty(PERSISTENCE_FACEBOOK_CLICK_ID)

        siblingWritesAndEventArrives(storageKey, (entry) => (entry[PERSISTENCE_FACEBOOK_CLICK_ID] = sibling))
        expect(persistence.props[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(local)

        persistence.flush()
        expect(readEntry(storageKey)[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(local)

        // Once flushed, the pending guard is gone and a later sibling write is adopted again.
        siblingWritesAndEventArrives(storageKey, (entry) => (entry[PERSISTENCE_FACEBOOK_CLICK_ID] = sibling))
        expect(persistence.props[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(sibling)
    })

    it('does not read the persistence entry while persistence is disabled', () => {
        const { posthog, storageKey } = setupWithManyFlags({ persistence: 'localStorage' })
        posthog.set_config({ disable_persistence: true })

        const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
        posthog.capture('$autocapture')

        expect(getItemSpy.mock.calls.filter(([key]) => key === storageKey)).toHaveLength(0)
    })
})

import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { defaultPostHog } from './helpers/posthog-instance'
import { PERSISTENCE_FACEBOOK_BROWSER_ID, PERSISTENCE_FACEBOOK_CLICK_ID } from '../constants'
import type { CaptureResult, PostHogConfig } from '../types'

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

const siblingSubdomainWritesCookie = (storageKey: string, patch: (cookie: Record<string, unknown>) => void) => {
    const cookieText = decodeURIComponent(
        document.cookie
            .split('; ')
            .find((entry) => entry.startsWith(`${storageKey}=`))!
            .split('=')[1]
    )
    const cookie = JSON.parse(cookieText)
    patch(cookie)
    document.cookie = `${storageKey}=${encodeURIComponent(JSON.stringify(cookie))}; path=/`
}

const META_RATE_LIMITING = { events_per_second: 1000, events_burst_limit: 1000 }

// Holds each capture request until the test answers it, so delivery can be confirmed late.
const setupMetaCapture = (config: Partial<PostHogConfig>, token: string = uuidv7(), name: string = token) => {
    const events: CaptureResult[] = []
    const posthog = defaultPostHog().init(
        token,
        {
            person_profiles: 'always',
            request_batching: false,
            rate_limiting: META_RATE_LIMITING,
            before_send: (event) => {
                if (event) {
                    events.push(event)
                }
                return event
            },
            ...config,
        },
        name
    )!
    const pendingResponses: (() => void)[] = []
    vi.spyOn(posthog, '_send_retriable_request').mockImplementation((options) => {
        pendingResponses.push(() => options.callback?.({ statusCode: 200 }))
    })
    const lastEvent = () => events[events.length - 1]
    return { posthog, events, lastEvent, pendingResponses, storageKey: `ph_${token}_posthog` }
}

const captureFromAd = (client: ReturnType<typeof setupMetaCapture>, click: string) => {
    const originalUrl = window.location.href
    window.history.replaceState(null, '', `/?fbclid=${click}`)
    try {
        client.posthog.capture('landed from an ad')
    } finally {
        window.history.replaceState(null, '', originalUrl)
    }
    return client.lastEvent().$set?.$fbc
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
        ['memory', false, false],
        ['memory', false, true],
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

    it('adopts the $fbc that another tab wrote while a refresh was parsing', () => {
        const { posthog, storageKey } = setupWithManyFlags({ persistence: 'localStorage' })
        const persistence = posthog.persistence!
        const writeSiblingFbc = (value: string) => {
            const siblingEntry = JSON.parse(localStorage.getItem(storageKey)!)
            siblingEntry[PERSISTENCE_FACEBOOK_CLICK_ID] = { value, delivered: true }
            localStorage.setItem(storageKey, JSON.stringify(siblingEntry))
        }
        writeSiblingFbc('fb.1.1700000000000.first')
        const refreshKeys = persistence['_refreshKeys'].bind(persistence)
        vi.spyOn(persistence as any, '_refreshKeys').mockImplementationOnce((keys) => {
            refreshKeys(keys as string[])
            writeSiblingFbc('fb.1.1700000000000.during-parse')
        })

        persistence.refreshMetaIdentifiers()
        persistence.refreshMetaIdentifiers()

        expect(persistence.props[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual({
            value: 'fb.1.1700000000000.during-parse',
            delivered: true,
        })
    })

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

    it('fills a Meta identifier from the shared cookie a sibling subdomain wrote, without parsing the entry', () => {
        const { posthog, storageKey } = setupWithManyFlags({ persistence: 'localStorage+cookie' })
        const fbc = { value: 'fb.1.1700000000000.subdomain', delivered: true }
        const cookieParses = (parseSpy: { mock: { calls: unknown[][] } }) =>
            parseSpy.mock.calls.filter(
                ([text]) =>
                    typeof text === 'string' &&
                    text.includes(PERSISTENCE_FACEBOOK_CLICK_ID) &&
                    !text.includes(ACTIVE_FEATURE_FLAGS[0])
            )
        siblingSubdomainWritesCookie(storageKey, (cookie) => (cookie[PERSISTENCE_FACEBOOK_CLICK_ID] = fbc))
        let parseSpy = vi.spyOn(JSON, 'parse')
        posthog.persistence!.register({ unrelated: 'change' })

        expect(persistenceEntryParses(parseSpy)).toHaveLength(0)
        expect(cookieParses(parseSpy)).toHaveLength(1)
        expect(posthog.persistence!.props[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(fbc)
        expect(readEntry(storageKey)[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(fbc)

        // Our own writes do not trigger a cookie parse on the next write.
        parseSpy.mockRestore()
        parseSpy = vi.spyOn(JSON, 'parse')
        posthog.capture('$autocapture')
        posthog.capture('$autocapture')
        expect(cookieParses(parseSpy)).toHaveLength(0)

        // localStorage wins: a cookie value never replaces one this tab already holds.
        siblingSubdomainWritesCookie(
            storageKey,
            (cookie) => (cookie[PERSISTENCE_FACEBOOK_CLICK_ID] = { value: 'fb.1.1700000000000.other', delivered: true })
        )
        posthog.persistence!.register({ unrelated: 'again' })
        expect(posthog.persistence!.props[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(fbc)
    })

    it('keeps a newer cookie $fbc over an older sibling localStorage value when the cookie wins', () => {
        const { posthog, storageKey } = setupWithManyFlags({
            persistence: 'localStorage+cookie',
            cookieWinsOnConflict: true,
        })
        const older = { value: 'fb.1.1700000000000.older', delivered: true }
        const newer = { value: 'fb.1.1700000000001.newer', delivered: true }

        siblingWrites(storageKey, (entry) => (entry[PERSISTENCE_FACEBOOK_CLICK_ID] = older))
        siblingSubdomainWritesCookie(storageKey, (cookie) => (cookie[PERSISTENCE_FACEBOOK_CLICK_ID] = newer))

        posthog.persistence!.register({ unrelated: 'change' })

        expect(posthog.persistence!.props[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(newer)
        expect(readEntry(storageKey)[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(newer)
    })

    it('drops the Meta identifiers when a sibling tab removes the whole entry', () => {
        const { posthog, storageKey } = setupWithManyFlags({ persistence: 'localStorage' })
        posthog.persistence!.register({
            [PERSISTENCE_FACEBOOK_CLICK_ID]: { value: 'fb.1.1700000000000.local', delivered: true },
        })

        localStorage.removeItem(storageKey)
        window.dispatchEvent(
            new StorageEvent('storage', { key: storageKey, newValue: null, storageArea: localStorage })
        )

        expect(posthog.persistence!.props).not.toHaveProperty(PERSISTENCE_FACEBOOK_CLICK_ID)
        posthog.persistence!.register({ unrelated: 'change' })
        expect(readEntry(storageKey)).not.toHaveProperty(PERSISTENCE_FACEBOOK_CLICK_ID)
    })

    it('sends the $fbc a sibling subdomain wrote to the shared cookie before the debounced write (persistence: cookie)', () => {
        const { posthog, lastEvent, storageKey } = setupMetaCapture({
            persistence: 'cookie',
            persistence_save_debounce_ms: 250,
        })
        const persistence = posthog.persistence!
        persistence.register({
            [PERSISTENCE_FACEBOOK_CLICK_ID]: { value: 'fb.1.1700000000000.delivered', delivered: true },
        })
        persistence.flush()
        const sibling = { value: 'fb.1.1700000000001.sibling', delivered: false }

        siblingSubdomainWritesCookie(storageKey, (cookie) => (cookie[PERSISTENCE_FACEBOOK_CLICK_ID] = sibling))
        posthog.capture('after sibling write')

        expect(lastEvent().$set?.$fbc).toBe(sibling.value)
    })

    it('sends the $fbc the shared cookie fills before the debounced write (persistence: localStorage+cookie)', () => {
        const { posthog, lastEvent, storageKey } = setupMetaCapture({
            persistence: 'localStorage+cookie',
            persistence_save_debounce_ms: 250,
        })
        posthog.persistence!.flush()
        const sibling = { value: 'fb.1.1700000000001.subdomain', delivered: false }

        siblingSubdomainWritesCookie(storageKey, (cookie) => (cookie[PERSISTENCE_FACEBOOK_CLICK_ID] = sibling))
        posthog.capture('after sibling write')

        expect(lastEvent().$set?.$fbc).toBe(sibling.value)
    })

    it.each<PostHogConfig['persistence']>(['localStorage', 'cookie'])(
        'keeps a sibling $fbc that landed while our request was in flight pending (persistence: %s)',
        (persistence) => {
            const { posthog, lastEvent, pendingResponses, storageKey } = setupMetaCapture({ persistence })
            const ours = { value: 'fb.1.1700000000000.ours', delivered: false }
            const sibling = { value: 'fb.1.1700000000001.sibling', delivered: false }
            posthog.persistence!.register({ [PERSISTENCE_FACEBOOK_CLICK_ID]: ours })
            posthog.capture('sends ours')
            expect(lastEvent().$set?.$fbc).toBe(ours.value)

            // No storage event reaches this tab before the response does.
            if (persistence === 'cookie') {
                siblingSubdomainWritesCookie(storageKey, (cookie) => (cookie[PERSISTENCE_FACEBOOK_CLICK_ID] = sibling))
            } else {
                siblingWrites(storageKey, (entry) => (entry[PERSISTENCE_FACEBOOK_CLICK_ID] = sibling))
            }
            pendingResponses.forEach((respond) => respond())
            posthog.persistence!.register({ unrelated: 'change' })

            expect(posthog.persistence!.props[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(sibling)
            const stored =
                persistence === 'cookie' ? posthog.persistence!['_storage']._parse(storageKey) : readEntry(storageKey)
            expect(stored[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(sibling)
            posthog.capture('sends the sibling value')
            expect(lastEvent().$set?.$fbc).toBe(sibling.value)
        }
    )

    it.each<PostHogConfig['persistence']>(['localStorage', 'localStorage+cookie'])(
        'does not parse the persistence entry again for later responses confirming the same $fbc (persistence: %s)',
        (persistence) => {
            const { posthog, events, pendingResponses } = setupMetaCapture({ persistence })
            posthog.persistence!.register({
                $active_feature_flags: ACTIVE_FEATURE_FLAGS,
                [PERSISTENCE_FACEBOOK_CLICK_ID]: { value: 'fb.1.1700000000000.click', delivered: false },
            })
            for (let i = 0; i < 3; i++) {
                posthog.capture('sends the pending $fbc')
            }
            expect(events.map((event) => event.$set?.$fbc)).toEqual(Array(3).fill('fb.1.1700000000000.click'))

            const [firstResponse, ...laterResponses] = pendingResponses
            firstResponse()
            const parseSpy = vi.spyOn(JSON, 'parse')
            laterResponses.forEach((respond) => respond())

            expect(persistenceEntryParses(parseSpy)).toHaveLength(0)
            expect(posthog.persistence!.props[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual({
                value: 'fb.1.1700000000000.click',
                delivered: true,
            })
        }
    )

    it('sends the $fbc another frame wrote to the shared sessionStorage', () => {
        const token = uuidv7()
        const config: Partial<PostHogConfig> = {
            persistence: 'sessionStorage',
            bootstrap: { distinctID: 'frame-user' },
        }
        const first = setupMetaCapture(config, token, `${token}-first`)
        const second = setupMetaCapture(config, token, `${token}-second`)
        const fbc = { value: 'fb.1.1700000000000.other-frame', delivered: false }

        first.posthog.persistence!.register({ [PERSISTENCE_FACEBOOK_CLICK_ID]: fbc })
        first.posthog.persistence!.flush()
        second.posthog.capture('in the second frame')

        expect(second.lastEvent().$set?.$fbc).toBe(fbc.value)
    })

    describe('instances sharing the memory store', () => {
        const setupPair = () => {
            const token = uuidv7()
            const config: Partial<PostHogConfig> = {
                persistence: 'memory',
                persistence_save_debounce_ms: 250,
                bootstrap: { distinctID: 'shared-user' },
            }
            const p = setupMetaCapture(config, token, `${token}-p`)
            const q = setupMetaCapture(config, token, `${token}-q`)
            p.posthog.persistence!.flush()
            q.posthog.persistence!.flush()
            return { p, q }
        }

        it('sends the newer $fbc a sibling wrote', () => {
            const { p, q } = setupPair()

            captureFromAd(p, 'click-a')
            p.posthog.persistence!.flush()
            const newer = captureFromAd(q, 'click-b')
            q.posthog.persistence!.flush()
            p.posthog.capture('conversion')

            expect(newer).toMatch(/\.click-b$/)
            expect(p.lastEvent().$set?.$fbc).toBe(newer)
        })

        it('stops sending a $fbc once a sibling confirmed it', () => {
            const { p, q } = setupPair()

            const sent = captureFromAd(p, 'click-a')
            p.posthog.persistence!.flush()
            q.posthog.capture('sibling delivery')
            expect(q.lastEvent().$set?.$fbc).toBe(sent)
            q.pendingResponses.forEach((respond) => respond())
            q.posthog.persistence!.flush()
            p.posthog.capture('after confirmation')

            expect(p.lastEvent().$set?.$fbc).toBeUndefined()
        })

        it('keeps a local $fbc that has not been written yet', () => {
            const { p, q } = setupPair()

            captureFromAd(q, 'click-b')
            q.posthog.persistence!.flush()
            const local = captureFromAd(p, 'local-click')
            p.posthog.capture('conversion')

            expect(local).toMatch(/\.local-click$/)
            expect(p.lastEvent().$set?.$fbc).toBe(local)
        })
    })

    it('does not write back a $fbc after a sibling reset removed the entry', () => {
        const token = uuidv7()
        const p = setupMetaCapture({ persistence: 'localStorage' }, token, `${token}-p`)
        expect(captureFromAd(p, 'first-click')).toMatch(/\.first-click$/)
        p.posthog.persistence!.flush()

        const q = setupMetaCapture(
            { persistence: 'localStorage', persistence_save_debounce_ms: 250 },
            token,
            `${token}-q`
        )
        q.posthog.persistence!.flush()
        q.posthog.reset()
        expect(localStorage.getItem(p.storageKey)).toBeNull()

        p.posthog.capture('after the sibling reset')

        expect(readEntry(p.storageKey)).not.toHaveProperty(PERSISTENCE_FACEBOOK_CLICK_ID)
        expect(p.lastEvent().$set?.$fbc).toBeUndefined()
    })

    describe.each<PostHogConfig['persistence']>(['localStorage', 'localStorage+cookie'])(
        'when a sibling write is readable before its storage event (persistence: %s)',
        (persistence) => {
            const debounced = { persistence, persistence_save_debounce_ms: 250 }
            const ours = { value: 'fb.1.1700000000000.ours', delivered: true }

            const setupWithCachedFbc = () => {
                const capture = setupMetaCapture(debounced)
                capture.posthog.persistence!.register({ [PERSISTENCE_FACEBOOK_CLICK_ID]: ours })
                capture.posthog.persistence!.flush()
                return capture
            }

            it.each<[string, Partial<PostHogConfig>, boolean]>([
                ['before the storage event', {}, false],
                ['after the storage event', {}, true],
                ['with no debounce', { persistence_save_debounce_ms: 0 }, false],
                ['when the cookie wins', { cookieWinsOnConflict: true }, false],
            ])('sends the newer $fbc instead of the cached one %s', (_, config, storageEventFirst) => {
                const token = uuidv7()
                const p = setupMetaCapture({ ...debounced, ...config }, token, `${token}-p`)
                p.posthog.persistence!.register({ [PERSISTENCE_FACEBOOK_CLICK_ID]: ours })
                p.posthog.persistence!.flush()
                const sibling = { value: 'fb.1.1700000000001.sibling', delivered: false }

                const q = setupMetaCapture({ ...debounced, ...config }, token, `${token}-q`)
                q.posthog.persistence!.register({ [PERSISTENCE_FACEBOOK_CLICK_ID]: sibling })
                q.posthog.persistence!.flush()
                if (storageEventFirst) {
                    siblingStorageEventArrives(p.storageKey, localStorage.getItem(p.storageKey)!)
                }
                p.posthog.capture('conversion')

                expect(p.lastEvent().$set?.$fbc).toBe(sibling.value)
            })

            it('does not send a $fbc a sibling reset cleared', () => {
                const token = uuidv7()
                const p = setupMetaCapture(debounced, token, `${token}-p`)
                p.posthog.persistence!.register({
                    [PERSISTENCE_FACEBOOK_CLICK_ID]: { value: ours.value, delivered: false },
                })
                p.posthog.persistence!.flush()

                const q = setupMetaCapture(debounced, token, `${token}-q`)
                q.posthog.persistence!.flush()
                q.posthog.reset()
                expect(localStorage.getItem(p.storageKey)).toBeNull()

                p.posthog.capture('after the sibling reset')

                expect(p.lastEvent().$set?.$fbc).toBeUndefined()
            })

            it('keeps a local $fbc that is still waiting for the debounced write', () => {
                const { posthog, lastEvent, storageKey } = setupWithCachedFbc()
                const local = { value: 'fb.1.1700000000002.local', delivered: false }
                const sibling = { value: 'fb.1.1700000000001.sibling', delivered: false }

                posthog.persistence!.register({ [PERSISTENCE_FACEBOOK_CLICK_ID]: local })
                siblingWrites(storageKey, (entry) => (entry[PERSISTENCE_FACEBOOK_CLICK_ID] = sibling))
                posthog.capture('conversion')

                expect(lastEvent().$set?.$fbc).toBe(local.value)
            })

            it('stops parsing the persistence entry once the sibling write is adopted', () => {
                const { posthog, storageKey } = setupWithCachedFbc()
                posthog.persistence!.register({ $active_feature_flags: ACTIVE_FEATURE_FLAGS })
                posthog.persistence!.flush()

                siblingWrites(storageKey, (entry) => {
                    entry[PERSISTENCE_FACEBOOK_CLICK_ID] = { value: 'fb.1.1700000000001.sibling', delivered: true }
                })
                const parseSpy = vi.spyOn(JSON, 'parse')
                for (let i = 0; i < 5; i++) {
                    posthog.capture('$autocapture')
                }

                // The hybrid store's parse writes the merged entry back, which costs one more parse.
                expect(persistenceEntryParses(parseSpy)).toHaveLength(persistence === 'localStorage' ? 1 : 2)
            })
        }
    )

    it('keeps a cookie-only $fbc on the first write when localStorage has no entry yet', () => {
        const token = uuidv7()
        const storageKey = `ph_${token}_posthog`
        const fbc = { value: 'fb.1.1700000000000.cookie-only', delivered: false }
        document.cookie = `${storageKey}=${encodeURIComponent(
            JSON.stringify({ distinct_id: 'cookie-user', [PERSISTENCE_FACEBOOK_CLICK_ID]: fbc })
        )}; path=/`

        const { posthog } = setupMetaCapture({ persistence: 'localStorage+cookie' }, token)

        expect(posthog.persistence!.props[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(fbc)
        expect(readEntry(storageKey)[PERSISTENCE_FACEBOOK_CLICK_ID]).toEqual(fbc)
    })

    it('does not read the persistence entry while persistence is disabled', () => {
        const { posthog, storageKey } = setupWithManyFlags({ persistence: 'localStorage' })
        posthog.set_config({ disable_persistence: true })

        const getItemSpy = vi.spyOn(Storage.prototype, 'getItem')
        posthog.capture('$autocapture')

        expect(getItemSpy.mock.calls.filter(([key]) => key === storageKey)).toHaveLength(0)
    })
})

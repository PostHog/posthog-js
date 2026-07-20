/// <reference lib="dom" />
import { PostHogPersistence } from '../posthog-persistence'
import {
    DEVICE_ID,
    ENABLED_FEATURE_FLAGS,
    INITIAL_PERSON_INFO,
    PERSISTENCE_ACTIVE_FEATURE_FLAGS,
    PERSISTENCE_FEATURE_FLAG_DETAILS,
    PERSISTENCE_FEATURE_FLAG_EVALUATED_AT,
    PERSISTENCE_FEATURE_FLAG_PAYLOADS,
    PERSISTENCE_FEATURE_FLAG_REQUEST_ID,
    PERSISTENCE_OVERRIDE_FEATURE_FLAGS,
    PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS,
    PRODUCT_TOURS,
    PRODUCT_TOURS_ACTIVATED,
    SESSION_ID,
    SESSION_RECORDING_REMOTE_CONFIG,
    SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX,
    SURVEYS,
    SURVEYS_ACTIVATED,
    SURVEYS_LOADED_AT,
    USER_STATE,
} from '../constants'
import { PERSISTENCE_KEY_POLICY } from '../persistence-key-policy'
import { PostHogConfig } from '../types'
import { PostHog } from '../posthog-core'
import { window } from '../utils/globals'
import { uuidv7 } from '../uuidv7'
import {
    cookieStore,
    localStore,
    resetLocalStorageSupported,
    resetSessionStorageSupported,
    sessionStore,
} from '../storage'
import { defaultPostHog } from './helpers/posthog-instance'
import Mock = jest.Mock

let referrer = '' // No referrer by default
Object.defineProperty(document, 'referrer', { get: () => referrer })

const PERSISTENCE_RESERVED_PROPERTIES = Object.keys(PERSISTENCE_KEY_POLICY).filter(
    (key) => PERSISTENCE_KEY_POLICY[key].exposure !== 'event'
)

const LEGACY_RESERVED_PERSISTENCE_KEYS = new Set([
    '$people_distinct_id',
    '__alias',
    '__cmpns',
    '__timers',
    '$session_recording_enabled_server_side',
    '$heatmaps_enabled_server_side',
    '$sesid',
    '$enabled_feature_flags',
    '$error_tracking_suppression_rules',
    '$user_state',
    '$early_access_features',
    '$feature_flag_details',
    '$stored_group_properties',
    '$stored_person_properties',
    '$surveys',
    '$surveys_loaded_at',
    '$flag_call_reported',
    '$flag_call_reported_session_id',
    '$feature_flag_errors',
    '$feature_flag_evaluated_at',
    '$minimal_flag_called_events',
    '$client_session_props',
    '$capture_rate_limit',
    '$initial_campaign_params',
    '$initial_referrer_info',
    '$epp',
    '$initial_person_info',
    'ph_product_tours',
    '$product_tours_activated',
    '$product_tours_enabled_server_side',
    '$session_recording_remote_config',
    '$override_feature_flag_payloads',
    '$sess_rec_flush_size',
])

const LEGACY_HIDDEN_SDK_PERSISTENCE_KEYS = [...LEGACY_RESERVED_PERSISTENCE_KEYS].filter(
    (key) => key !== ENABLED_FEATURE_FLAGS
)

const LEGACY_EVENT_VISIBLE_SDK_PERSISTENCE_KEYS = Object.keys(PERSISTENCE_KEY_POLICY).filter(
    (key) => key !== ENABLED_FEATURE_FLAGS && !LEGACY_RESERVED_PERSISTENCE_KEYS.has(key)
)

function makePostHogConfig(name: string, persistenceMode: string): PostHogConfig {
    return <PostHogConfig>{
        name,
        persistence: persistenceMode as 'cookie' | 'localStorage' | 'localStorage+cookie' | 'memory' | 'sessionStorage',
    }
}

describe('persistence', () => {
    let library: PostHogPersistence

    afterEach(() => {
        library?.clear()
        document.cookie = ''
        referrer = ''
    })

    const persistenceModes: string[] = ['cookie', 'localStorage', 'localStorage+cookie']
    describe.each(persistenceModes)('persistence modes: %p', (persistenceMode) => {
        // Common tests for all storage modes
        beforeEach(() => {
            library = new PostHogPersistence(makePostHogConfig('test', persistenceMode))
            library.clear()
        })

        it('should register_once', () => {
            library.register_once({ distinct_id: 'hi', test_prop: 'test_val' }, undefined, undefined)

            const lib2 = new PostHogPersistence(makePostHogConfig('test', persistenceMode))
            expect(lib2.props).toEqual({ distinct_id: 'hi', test_prop: 'test_val' })
        })

        it('should save user state', () => {
            const lib = new PostHogPersistence(makePostHogConfig('bla', persistenceMode))
            lib.set_property(USER_STATE, 'identified')
            expect(lib.props[USER_STATE]).toEqual('identified')
        })

        it('can load user state', () => {
            const lib = new PostHogPersistence(makePostHogConfig('bla', persistenceMode))
            lib.set_property(USER_STATE, 'identified')
            expect(lib.get_property(USER_STATE)).toEqual('identified')
        })

        it('has user state as a reserved property key', () => {
            const lib = new PostHogPersistence(makePostHogConfig('bla', persistenceMode))
            lib.register({ distinct_id: 'testy', test_prop: 'test_value' })
            lib.set_property(USER_STATE, 'identified')
            expect(lib.properties()).toEqual({ distinct_id: 'testy', test_prop: 'test_value' })
        })

        it(`should only call save if props changes`, () => {
            const lib = new PostHogPersistence(makePostHogConfig('test', 'localStorage+cookie'))
            lib.register({ distinct_id: 'hi', test_prop: 'test_val' })
            const saveMock: Mock = jest.fn()
            lib.save = saveMock

            lib.register({ distinct_id: 'hi', test_prop: 'test_val' })
            lib.register({})
            lib.register({ distinct_id: 'hi' })
            expect(lib.save).toHaveBeenCalledTimes(0)

            lib.register({ distinct_id: 'hi2' })
            expect(lib.save).toHaveBeenCalledTimes(1)
            saveMock.mockClear()

            lib.register({ new_key: '1234' })
            expect(lib.save).toHaveBeenCalledTimes(1)
            saveMock.mockClear()
        })

        it('should rebuild storage when cookie_persisted_properties changes via update_config', () => {
            const encode = (props: any) => encodeURIComponent(JSON.stringify(props))
            const expectedProps = () => ({
                distinct_id: 'test',
                test_prop: 'test_val',
                custom_prop: 'custom_value',
            })

            let config = makePostHogConfig('test', 'localStorage+cookie')
            const lib = new PostHogPersistence(config)
            lib.register(expectedProps())

            // Initially, custom_prop should NOT be in cookies (only default properties)
            expect(document.cookie).toContain(
                `ph__posthog=${encode({
                    distinct_id: 'test',
                })}`
            )
            expect(document.cookie).not.toContain('custom_prop')

            // Now update config to include custom_prop in cookie_persisted_properties
            const newConfig = {
                ...makePostHogConfig('test', 'localStorage+cookie'),
                cookie_persisted_properties: ['custom_prop'],
            }
            lib.update_config(newConfig, config)
            config = newConfig

            // After update, custom_prop should now be in cookies
            expect(document.cookie).toContain(
                `ph__posthog=${encode({
                    distinct_id: 'test',
                    custom_prop: 'custom_value',
                })}`
            )

            // Properties should still be the same
            expect(lib.props).toEqual(expectedProps())
            expect(localStorage.getItem('ph__posthog')).toEqual(JSON.stringify(expectedProps()))
        })

        it('should set direct referrer', () => {
            referrer = ''
            library.update_referrer_info()

            expect(library.props['$referring_domain']).toBe('$direct')
            expect(library.props['$referrer']).toBe('$direct')
        })

        it('should set external referrer', () => {
            referrer = 'https://www.google.com'
            library.update_referrer_info()

            expect(library.props['$referring_domain']).toBe('www.google.com')
            expect(library.props['$referrer']).toBe('https://www.google.com')
        })

        it('should set internal referrer', () => {
            referrer = 'https://hedgebox.net/files/abc.png'
            library.update_referrer_info()

            expect(library.props['$referring_domain']).toBe('hedgebox.net')
            expect(library.props['$referrer']).toBe('https://hedgebox.net/files/abc.png')
        })

        it('extracts enabled feature flags', () => {
            library.register({ $enabled_feature_flags: { flag: 'variant', other: true } })
            expect(library.props['$enabled_feature_flags']).toEqual({ flag: 'variant', other: true })
            expect(library.properties()).toEqual({
                '$feature/flag': 'variant',
                '$feature/other': true,
            })
        })

        it('skips $feature/ properties when cache is stale and TTL is configured', () => {
            const config = {
                ...makePostHogConfig('test', persistenceMode),
                feature_flag_cache_ttl_ms: 60 * 60 * 1000, // 1 hour TTL
            }
            const lib = new PostHogPersistence(config)

            // Set evaluated_at to 2 hours ago (stale)
            const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
            lib.register({
                $enabled_feature_flags: { flag: 'variant', other: true },
                $feature_flag_evaluated_at: twoHoursAgo,
            })

            // Should not include $feature/ properties since cache is stale
            expect(lib.properties()).toEqual({})
            lib.clear()
        })

        it('includes $feature/ properties when cache is fresh', () => {
            const config = {
                ...makePostHogConfig('test', persistenceMode),
                feature_flag_cache_ttl_ms: 60 * 60 * 1000, // 1 hour TTL
            }
            const lib = new PostHogPersistence(config)

            // Set evaluated_at to 30 minutes ago (fresh)
            const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000
            lib.register({
                $enabled_feature_flags: { flag: 'variant', other: true },
                $feature_flag_evaluated_at: thirtyMinutesAgo,
            })

            // Should include $feature/ properties since cache is fresh
            expect(lib.properties()).toEqual({
                '$feature/flag': 'variant',
                '$feature/other': true,
            })
            lib.clear()
        })

        it('includes $feature/ properties when TTL is not configured', () => {
            const config = {
                ...makePostHogConfig('test', persistenceMode),
                // No feature_flag_cache_ttl_ms set
            }
            const lib = new PostHogPersistence(config)

            // Set evaluated_at to a year ago
            const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000
            lib.register({
                $enabled_feature_flags: { flag: 'variant', other: true },
                $feature_flag_evaluated_at: oneYearAgo,
            })

            // Should include $feature/ properties since TTL is not configured
            expect(lib.properties()).toEqual({
                '$feature/flag': 'variant',
                '$feature/other': true,
            })
            lib.clear()
        })

        it('treats non-numeric evaluatedAt as stale when TTL is configured', () => {
            const config = {
                ...makePostHogConfig('test', persistenceMode),
                feature_flag_cache_ttl_ms: 60 * 60 * 1000, // 1 hour TTL
            }
            const lib = new PostHogPersistence(config)

            // Set evaluated_at to an ISO string instead of a timestamp
            lib.register({
                $enabled_feature_flags: { flag: 'variant' },
                $feature_flag_evaluated_at: '2025-01-01T00:00:00Z',
            })

            // Should not include $feature/ properties since evaluatedAt is not a number
            expect(lib.properties()).toEqual({})
            lib.clear()
        })

        it('should not return hidden properties()', () => {
            const initialPersonInfo = { r: 'https://referrer.example.com', u: 'https://initial-url.example.com' }
            library.register({
                [INITIAL_PERSON_INFO]: initialPersonInfo,
            })
            expect(library.props[INITIAL_PERSON_INFO]).toEqual(initialPersonInfo)
            expect(library.properties()).toEqual({})
        })

        it.each([
            [PRODUCT_TOURS, [{ id: 1, name: 'tour' }]],
            [PRODUCT_TOURS_ACTIVATED, ['tour-1']],
            [SESSION_RECORDING_REMOTE_CONFIG, { endpoint: '/s/' }],
            [PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS, { 'flag-a': '{"key":"value"}' }],
        ])('should not include reserved property %s in event properties', (key, value) => {
            library.register({ [key]: value })
            expect(library.props[key]).toEqual(value)
            expect(library.properties()).toEqual({})
        })

        it.each([
            [PERSISTENCE_FEATURE_FLAG_PAYLOADS, { 'flag-a': '{"key":"value"}' }],
            [SURVEYS_ACTIVATED, ['survey-1']],
        ])('should include explicitly event-visible SDK property %s in event properties', (key, value) => {
            library.register({ [key]: value })
            expect(library.properties()).toEqual({ [key]: value })
        })

        it.each(LEGACY_EVENT_VISIBLE_SDK_PERSISTENCE_KEYS)(
            'keeps legacy event-visible SDK persistence property %s visible in event properties',
            (key) => {
                library.register({ [key]: 'test-value' })
                expect(library.properties()).toEqual({ [key]: 'test-value' })
            }
        )

        it.each(LEGACY_HIDDEN_SDK_PERSISTENCE_KEYS)(
            'keeps legacy hidden SDK persistence property %s excluded from event properties',
            (key) => {
                library.register({ [key]: 'test-value' })
                expect(library.properties()).toEqual({})
            }
        )

        it('keeps SDK persistence keys matched by prefix policy hidden from event properties', () => {
            const key = `${SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX}abc123`
            library.register({ [key]: 'session-id' })
            expect(library.properties()).toEqual({})
        })

        it('should have all PERSISTENCE_RESERVED_PROPERTIES excluded from properties()', () => {
            for (const key of PERSISTENCE_RESERVED_PROPERTIES) {
                library.register({ [key]: 'test-value' })
            }
            expect(library.properties()).toEqual({})
        })

        describe('no-op write rejection in save()', () => {
            // save() short-circuits if the serialized props are unchanged
            // since the last successful write. cookieStore and localStore
            // are shared singletons; the spy may carry calls from setup
            // (library.clear() removes both subdomain variants, which
            // cookieStore._remove implements as two _set calls). We
            // mockClear() after the setup write to isolate the assertion.

            it('skips storage writes when props are unchanged', () => {
                library.register({ distinct_id: 'hi' })
                const storageSetSpy = jest.spyOn(library['_storage'], '_set')
                storageSetSpy.mockClear()

                library.save()
                library.save()
                library.save()

                expect(storageSetSpy).not.toHaveBeenCalled()
            })

            it('writes when a value changes', () => {
                library.register({ distinct_id: 'hi' })
                const storageSetSpy = jest.spyOn(library['_storage'], '_set')
                storageSetSpy.mockClear()

                library.register({ distinct_id: 'bye' })
                expect(storageSetSpy).toHaveBeenCalledTimes(1)
            })

            it('writes again after a remove() resets the cache', () => {
                library.register({ distinct_id: 'hi' })
                const storageSetSpy = jest.spyOn(library['_storage'], '_set')

                // Without remove(), the save below would be deduped.
                library.remove()
                storageSetSpy.mockClear()
                library.save()

                expect(storageSetSpy).toHaveBeenCalledTimes(1)
            })

            it('writes through after remove() even if props are unchanged', () => {
                library.register({ distinct_id: 'hi' })
                library.remove()
                const storageSetSpy = jest.spyOn(library['_storage'], '_set')
                storageSetSpy.mockClear()

                // save() with unchanged props would normally be a no-op.
                // After remove(), the cache was cleared, so this must
                // write through — there is nothing in storage right now.
                library.save()
                expect(storageSetSpy).toHaveBeenCalled()
            })

            it('treats equivalent props (same JSON) as no-op even with new object identity', () => {
                library.register({ distinct_id: 'hi', tags: ['a', 'b'] })
                const storageSetSpy = jest.spyOn(library['_storage'], '_set')
                storageSetSpy.mockClear()

                // Force a save() with no real change. register() guards
                // against this via `!==`, so call save() directly.
                library.save()

                expect(storageSetSpy).not.toHaveBeenCalled()
            })

            it.each([
                {
                    label: 'expire_days change',
                    mutate: (lib: PostHogPersistence) => ((lib as any)._expire_days = 90),
                },
                {
                    label: 'cross_subdomain change',
                    mutate: (lib: PostHogPersistence) => ((lib as any)._cross_subdomain = true),
                },
                {
                    label: 'secure change',
                    mutate: (lib: PostHogPersistence) => ((lib as any)._secure = true),
                },
            ])('writes through when $label invalidates the storage args, even with unchanged props', ({ mutate }) => {
                // The no-op fingerprint must cover all four arguments to
                // `_storage._set` — serialized props plus expire_days,
                // cross_subdomain, secure. Otherwise a customer who calls
                // `posthog.set_config({ cookie_expiration: 90 })` would
                // mutate `_expire_days` but the no-op check (which only
                // saw props) would short-circuit, and the cookie keeps
                // its old `Expires` header until some other prop changes.
                library.register({ distinct_id: 'hi' })
                const storageSetSpy = jest.spyOn(library['_storage'], '_set')
                storageSetSpy.mockClear()

                mutate(library)
                library.save()

                expect(storageSetSpy).toHaveBeenCalledTimes(1)
            })

            it.each([
                { label: 'BigInt', value: BigInt(1234567890123) },
                {
                    label: 'circular reference',
                    value: (() => {
                        const o: any = {}
                        o.self = o
                        return o
                    })(),
                },
            ])('does not throw on $label values that JSON.stringify rejects', ({ value }) => {
                // Pre-existing behaviour: unserializable values like BigInt
                // and circular references were caught by the storage layer's
                // own try/catch and logged/dropped. The no-op fingerprint
                // calls JSON.stringify too, but we mustn't propagate the
                // exception out of save() — application code that registered
                // such values would crash.
                library.register({ ok: 'value', weird: value })
                expect(() => library.save()).not.toThrow()
            })
        })

        describe('refreshKey', () => {
            // Pulls a single key from on-disk storage into in-memory props
            // without a whole-blob flush() (which would clobber a sibling's
            // write) or load() (which would discard pending in-memory writes).
            let parseSpy: jest.SpyInstance

            afterEach(() => {
                parseSpy?.mockRestore()
            })

            it('pulls a single key from storage and leaves other in-memory props untouched', () => {
                library.register({ distinct_id: 'mine', other: 'in-memory-only' })

                // Simulate a sibling having written a different value for one key.
                const onDisk = { ...library.props, distinct_id: 'from-sibling' }
                parseSpy = jest.spyOn(library['_storage'], '_parse').mockReturnValue(onDisk)

                library.refreshKey('distinct_id')

                expect(library.props.distinct_id).toBe('from-sibling')
                expect(library.props.other).toBe('in-memory-only')
            })

            it('does not write to storage', () => {
                library.register({ distinct_id: 'mine' })
                parseSpy = jest.spyOn(library['_storage'], '_parse').mockReturnValue({ distinct_id: 'from-sibling' })
                const storageSetSpy = jest.spyOn(library['_storage'], '_set')
                storageSetSpy.mockClear()

                library.refreshKey('distinct_id')

                expect(storageSetSpy).not.toHaveBeenCalled()
                storageSetSpy.mockRestore()
            })

            it('deletes the in-memory key when storage no longer has it', () => {
                library.register({ distinct_id: 'mine', keep: 'me' })
                parseSpy = jest.spyOn(library['_storage'], '_parse').mockReturnValue({ keep: 'me' })

                library.refreshKey('distinct_id')

                expect(library.props.distinct_id).toBeUndefined()
                expect(library.props.keep).toBe('me')
            })
        })

        describe('save debounce', () => {
            // `persistence_save_debounce_ms` coalesces rapid save() calls
            // into a single write per window. The default is 0 (immediate).
            beforeEach(() => {
                jest.useFakeTimers()
            })

            afterEach(() => {
                jest.runOnlyPendingTimers()
                jest.useRealTimers()
            })

            it('writes immediately when debounce is 0 (default)', () => {
                const config = makePostHogConfig('test-debounce-off', persistenceMode)
                const debounced = new PostHogPersistence(config)
                const spy = jest.spyOn(debounced['_storage'], '_set')
                spy.mockClear()

                debounced.register({ distinct_id: 'a' })
                debounced.register({ distinct_id: 'b' })

                expect(spy).toHaveBeenCalledTimes(2)
                debounced.clear()
            })

            it('coalesces multiple saves within the debounce window into one write', () => {
                const config = {
                    ...makePostHogConfig('test-debounce-on', persistenceMode),
                    persistence_save_debounce_ms: 250,
                }
                const debounced = new PostHogPersistence(config)
                const spy = jest.spyOn(debounced['_storage'], '_set')
                spy.mockClear()

                debounced.register({ a: '1' })
                debounced.register({ b: '2' })
                debounced.register({ c: '3' })

                expect(spy).not.toHaveBeenCalled()

                jest.advanceTimersByTime(250)

                expect(spy).toHaveBeenCalledTimes(1)
                expect(debounced.props).toMatchObject({ a: '1', b: '2', c: '3' })
                debounced.clear()
            })

            it('in-memory props update synchronously even before the debounced write lands', () => {
                const config = {
                    ...makePostHogConfig('test-debounce-sync', persistenceMode),
                    persistence_save_debounce_ms: 250,
                }
                const debounced = new PostHogPersistence(config)

                debounced.register({ distinct_id: 'live' })
                expect(debounced.props.distinct_id).toBe('live')
                debounced.clear()
            })

            it('flush() writes pending state immediately', () => {
                const config = {
                    ...makePostHogConfig('test-debounce-flush', persistenceMode),
                    persistence_save_debounce_ms: 250,
                }
                const debounced = new PostHogPersistence(config)
                const spy = jest.spyOn(debounced['_storage'], '_set')
                spy.mockClear()

                debounced.register({ distinct_id: 'before-flush' })
                expect(spy).not.toHaveBeenCalled()

                debounced.flush()
                expect(spy).toHaveBeenCalledTimes(1)

                jest.advanceTimersByTime(1000)
                expect(spy).toHaveBeenCalledTimes(1)
                debounced.clear()
            })

            it('remove() cancels any pending debounced write', () => {
                const config = {
                    ...makePostHogConfig('test-debounce-remove', persistenceMode),
                    persistence_save_debounce_ms: 250,
                }
                const debounced = new PostHogPersistence(config)
                const setSpy = jest.spyOn(debounced['_storage'], '_set')
                const removeSpy = jest.spyOn(debounced['_storage'], '_remove')

                debounced.register({ distinct_id: 'doomed' })
                setSpy.mockClear()
                removeSpy.mockClear()

                debounced.remove()
                jest.advanceTimersByTime(1000)

                expect(setSpy).not.toHaveBeenCalled()
                expect(removeSpy).toHaveBeenCalled()
            })

            it('flush() does NOT resurrect storage after remove() (the reset bug)', () => {
                // Sequence: posthog.reset() → clear() → remove() cancels
                // the timer, resets _slotState, deletes storage.
                // Then the unload listener fires flush(). Without the
                // pending-timer guard, flush() would call _writeNow() with
                // props={}, mismatch against the now-empty _slotState,
                // and resurrect the storage entry that remove() just
                // deleted. The guard means flush() is a no-op once there
                // is no pending timer.
                const config = {
                    ...makePostHogConfig('test-flush-after-remove', persistenceMode),
                    persistence_save_debounce_ms: 250,
                }
                const debounced = new PostHogPersistence(config)
                debounced.register({ distinct_id: 'before-reset' })

                // Simulate reset
                debounced.clear()

                const setSpy = jest.spyOn(debounced['_storage'], '_set')
                setSpy.mockClear()

                // Simulate the unload listener firing after reset
                debounced.flush()

                expect(setSpy).not.toHaveBeenCalled()
            })

            it('writes through on flush() when debounce is enabled at runtime via set_config (late-enable)', () => {
                // Customer constructs PostHog with debounce=0 (no listener
                // would be installed under the old logic), then later does
                // `posthog.set_config({ persistence_save_debounce_ms: 250 })`.
                // The mutable config is read every save() via _saveDebounceMs(),
                // so save() correctly starts debouncing. But we must ALSO
                // have installed unload listeners at construction so the
                // pending write isn't lost on page close.
                const config: any = makePostHogConfig('test-late-debounce', persistenceMode)
                const debounced = new PostHogPersistence(config)
                const spy = jest.spyOn(debounced['_storage'], '_set')

                // Enable debounce after construction.
                config.persistence_save_debounce_ms = 250
                spy.mockClear()

                debounced.register({ distinct_id: 'late' })

                // The debounced write is pending — not in storage yet.
                expect(spy).not.toHaveBeenCalled()

                // Simulate the unload listener firing.
                debounced.flush()

                expect(spy).toHaveBeenCalledTimes(1)
                debounced.clear()
            })
        })
    })

    describe('localStorage+cookie', () => {
        const encode = (props: any) => encodeURIComponent(JSON.stringify(props))

        it('should migrate data from cookies to localStorage', () => {
            const lib = new PostHogPersistence(makePostHogConfig('bla', 'cookie'))
            lib.register_once({ distinct_id: 'testy', test_prop: 'test_value' }, undefined, undefined)
            expect(document.cookie).toContain(
                'ph__posthog=%7B%22distinct_id%22%3A%22testy%22%2C%22test_prop%22%3A%22test_value%22%7D'
            )
            const lib2 = new PostHogPersistence(makePostHogConfig('bla', 'localStorage+cookie'))
            expect(document.cookie).toContain('ph__posthog=%7B%22distinct_id%22%3A%22testy%22%7D')
            lib2.register({ test_prop2: 'test_val', distinct_id: 'test2' })
            expect(document.cookie).toContain('ph__posthog=%7B%22distinct_id%22%3A%22test2%22%7D')
            expect(lib2.props).toEqual({ distinct_id: 'test2', test_prop: 'test_value', test_prop2: 'test_val' })
            lib2.remove()
            expect(localStorage.getItem('ph__posthog')).toEqual(null)
            expect(document.cookie).toEqual('')
        })

        it(`should additionally store certain values in cookies if localStorage+cookie`, () => {
            expect(document.cookie).toEqual('')

            const lib = new PostHogPersistence(makePostHogConfig('test', 'localStorage+cookie'))
            lib.register({ distinct_id: 'test', test_prop: 'test_val', [DEVICE_ID]: 'device-123' })
            expect(document.cookie).toContain(
                `ph__posthog=${encode({
                    $device_id: 'device-123',
                    distinct_id: 'test',
                })}`
            )
            expect(document.cookie).not.toContain('test_prop')

            lib.register({ otherProp: 'prop' })
            expect(document.cookie).toContain(
                `ph__posthog=${encode({
                    $device_id: 'device-123',
                    distinct_id: 'test',
                })}`
            )

            lib.register({ [SESSION_ID]: [1000, 'sid', 2000] })
            expect(document.cookie).toContain(
                `ph__posthog=${encode({
                    $device_id: 'device-123',
                    distinct_id: 'test',
                    $sesid: [1000, 'sid', 2000],
                })}`
            )

            lib.register({ [INITIAL_PERSON_INFO]: { u: 'https://www.example.com', r: 'https://www.referrer.com' } })
            expect(document.cookie).toContain(
                `ph__posthog=${encode({
                    $device_id: 'device-123',
                    distinct_id: 'test',
                    $sesid: [1000, 'sid', 2000],
                    $initial_person_info: { u: 'https://www.example.com', r: 'https://www.referrer.com' },
                })}`
            )

            lib.set_property(USER_STATE, 'identified')
            expect(document.cookie).toContain(
                `ph__posthog=${encode({
                    $device_id: 'device-123',
                    distinct_id: 'test',
                    $sesid: [1000, 'sid', 2000],
                    $initial_person_info: { u: 'https://www.example.com', r: 'https://www.referrer.com' },
                    $user_state: 'identified',
                })}`
            )

            // Clear localstorage to simulate being on a different domain
            localStorage.clear()

            const newLib = new PostHogPersistence(makePostHogConfig('test', 'localStorage+cookie'))

            // Cookie-persisted properties should be recovered after localStorage is cleared
            expect(newLib.props).toEqual({
                distinct_id: 'test',
                $device_id: 'device-123',
                $sesid: [1000, 'sid', 2000],
                $initial_person_info: { u: 'https://www.example.com', r: 'https://www.referrer.com' },
                $user_state: 'identified',
            })
        })

        it('should persist custom properties to cookies when using localStorage+cookie', () => {
            const customProp = 'my_custom_prop'
            const token = uuidv7()

            const posthog = defaultPostHog().init(
                token,
                {
                    persistence: 'localStorage+cookie',
                    cookie_persisted_properties: [customProp],
                },
                uuidv7()
            )

            const persistence = posthog.persistence as PostHogPersistence

            persistence.register({ [customProp]: 'test_value' })

            // Get the persistence name from the instance
            // @ts-expect-error - _name is private and only accessible within class 'PostHogPersistence'
            const persistenceName = persistence._name

            // Verify the custom property is in the cookie
            const cookieData = cookieStore._parse(persistenceName)
            expect(cookieData[customProp]).toBe('test_value')

            // Verify it's also in localStorage (full props)
            const localStorageData = JSON.parse(localStorage.getItem(persistenceName) || '{}')
            expect(localStorageData[customProp]).toBe('test_value')

            // Verify default properties are also in cookie
            expect(cookieData.distinct_id).toBeDefined()

            // Make sure we clean up after ourselves to avoid affecting other tests
            persistence.clear()
        })

        describe('merge precedence', () => {
            // The default merge in createLocalPlusCookieStore._parse is
            // extend(cookieProperties, localStorageData) — localStorage wins.
            // With __preview_cookie_wins_on_conflict: true, that order flips so the
            // cross-subdomain cookie is authoritative for the keys it stores.
            const persistenceName = 'ph__posthog'
            const encodeCookie = (props: Record<string, any>) =>
                `${persistenceName}=${encodeURIComponent(JSON.stringify(props))}`

            function makeConfig(persistenceMode: string, cookieWins: boolean): PostHogConfig {
                return <PostHogConfig>{
                    name: '',
                    persistence: persistenceMode as
                        | 'cookie'
                        | 'localStorage'
                        | 'localStorage+cookie'
                        | 'memory'
                        | 'sessionStorage',
                    __preview_cookie_wins_on_conflict: cookieWins,
                }
            }

            beforeEach(() => {
                document.cookie = `${persistenceName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
                localStorage.clear()
            })

            it('default (flag off): localStorage wins for keys present in both stores', () => {
                // Seed both stores with conflicting distinct_id
                document.cookie = encodeCookie({ distinct_id: 'from_cookie', $device_id: 'd1' })
                localStorage.setItem(persistenceName, JSON.stringify({ distinct_id: 'from_localstorage' }))

                const lib = new PostHogPersistence(makeConfig('localStorage+cookie', false))

                expect(lib.props.distinct_id).toBe('from_localstorage')
                // Keys only in cookie still flow through (no localStorage value to override)
                expect(lib.props.$device_id).toBe('d1')
            })

            it('flag on: cookie wins for keys present in both stores', () => {
                document.cookie = encodeCookie({ distinct_id: 'from_cookie', $device_id: 'd1' })
                localStorage.setItem(persistenceName, JSON.stringify({ distinct_id: 'from_localstorage' }))

                const lib = new PostHogPersistence(makeConfig('localStorage+cookie', true))

                expect(lib.props.distinct_id).toBe('from_cookie')
                expect(lib.props.$device_id).toBe('d1')
            })

            it('flag on: cross-subdomain identify scenario - fresh cookie state wins over stale localStorage', () => {
                // Models the bug this flag exists to fix: localStorage on a subdomain carries
                // stale anonymous state from a prior visit, while the shared cookie carries
                // fresh identified state written by an identify() on another subdomain.
                const staleLocalStorage = {
                    distinct_id: 'anon-uuid',
                    $device_id: 'anon-uuid',
                    $sesid: [1000, 'old-sid', 1000],
                    $user_state: 'anonymous',
                    $initial_person_info: { u: 'https://www.example.com/old', r: 'https://www.bing.com/' },
                }
                const freshCookie = {
                    distinct_id: 'user@x.com',
                    $device_id: 'anon-uuid',
                    $sesid: [9999, 'new-sid', 9999],
                    $user_state: 'identified',
                    $initial_person_info: { u: 'https://app.example.com/dash', r: 'https://www.example.com/' },
                }
                document.cookie = encodeCookie(freshCookie)
                localStorage.setItem(persistenceName, JSON.stringify(staleLocalStorage))

                const lib = new PostHogPersistence(makeConfig('localStorage+cookie', true))

                expect(lib.props.distinct_id).toBe('user@x.com')
                expect(lib.props.$device_id).toBe('anon-uuid')
                expect(lib.props.$sesid).toEqual([9999, 'new-sid', 9999])
                expect(lib.props.$user_state).toBe('identified')
                expect(lib.props.$initial_person_info).toEqual({
                    u: 'https://app.example.com/dash',
                    r: 'https://www.example.com/',
                })
            })

            it('flag on: self-heals stale localStorage by writing the merged value back', () => {
                document.cookie = encodeCookie({ distinct_id: 'from_cookie' })
                localStorage.setItem(persistenceName, JSON.stringify({ distinct_id: 'from_localstorage' }))

                new PostHogPersistence(makeConfig('localStorage+cookie', true))

                // The _parse self-heal writes the merged value back to localStorage
                const localStorageAfter = JSON.parse(localStorage.getItem(persistenceName) || '{}')
                expect(localStorageAfter.distinct_id).toBe('from_cookie')
            })

            it('flag on: localStorage-only keys are preserved (cookie does not carry them)', () => {
                document.cookie = encodeCookie({ distinct_id: 'from_cookie' })
                localStorage.setItem(
                    persistenceName,
                    JSON.stringify({
                        distinct_id: 'from_localstorage',
                        // keys NOT in COOKIE_PERSISTED_PROPERTIES — they live only in localStorage
                        $surveys: ['s1', 's2'],
                        super_prop: 'value',
                    })
                )

                const lib = new PostHogPersistence(makeConfig('localStorage+cookie', true))

                expect(lib.props.distinct_id).toBe('from_cookie')
                expect(lib.props.$surveys).toEqual(['s1', 's2'])
                expect(lib.props.super_prop).toBe('value')
            })

            it('flag on: empty cookie is a no-op, localStorage round-trips intact', () => {
                expect(document.cookie).toEqual('')
                localStorage.setItem(persistenceName, JSON.stringify({ distinct_id: 'ls_only', super_prop: 'value' }))

                const lib = new PostHogPersistence(makeConfig('localStorage+cookie', true))

                expect(lib.props.distinct_id).toBe('ls_only')
                expect(lib.props.super_prop).toBe('value')
            })

            it('flag on: empty localStorage, cookie-only data populates props', () => {
                document.cookie = encodeCookie({ distinct_id: 'cookie_only', $device_id: 'd1' })
                expect(localStorage.getItem(persistenceName)).toBe(null)

                const lib = new PostHogPersistence(makeConfig('localStorage+cookie', true))

                expect(lib.props.distinct_id).toBe('cookie_only')
                expect(lib.props.$device_id).toBe('d1')
            })

            it('flag on: defensive filter - null cookie value does NOT clobber valid localStorage value', () => {
                document.cookie = encodeCookie({ distinct_id: null })
                localStorage.setItem(persistenceName, JSON.stringify({ distinct_id: 'valid' }))

                const lib = new PostHogPersistence(makeConfig('localStorage+cookie', true))

                expect(lib.props.distinct_id).toBe('valid')
            })

            it('flag on: defensive filter - empty-string cookie value does NOT clobber valid localStorage value', () => {
                document.cookie = encodeCookie({ distinct_id: '' })
                localStorage.setItem(persistenceName, JSON.stringify({ distinct_id: 'valid' }))

                const lib = new PostHogPersistence(makeConfig('localStorage+cookie', true))

                expect(lib.props.distinct_id).toBe('valid')
            })

            it('flag on: has no effect for non-conflicting keys regardless of source', () => {
                document.cookie = encodeCookie({ distinct_id: 'from_cookie', cookie_only_key: 'c' })
                localStorage.setItem(persistenceName, JSON.stringify({ super_prop: 'ls', ls_only_key: 'l' }))

                const lib = new PostHogPersistence(makeConfig('localStorage+cookie', true))

                // All non-conflicting keys merge into props from their respective stores
                expect(lib.props.distinct_id).toBe('from_cookie')
                expect(lib.props.cookie_only_key).toBe('c')
                expect(lib.props.super_prop).toBe('ls')
                expect(lib.props.ls_only_key).toBe('l')
            })
        })

        it('should allow swapping between storage methods', () => {
            const expectedProps = () => ({ distinct_id: 'test', test_prop: 'test_val', $is_identified: false })

            let config = makePostHogConfig('test', 'localStorage+cookie')
            const lib = new PostHogPersistence(makePostHogConfig('test', 'localStorage+cookie'))
            lib.register(expectedProps())

            expect(lib.properties()).toEqual(expectedProps())
            expect(document.cookie).toContain(
                `ph__posthog=${encode({
                    distinct_id: 'test',
                })}`
            )
            expect(document.cookie).not.toContain('test_prop')
            expect(localStorage.getItem('ph__posthog')).toEqual(JSON.stringify(expectedProps()))

            // Swap to memory
            let newConfig = makePostHogConfig('test', 'memory')
            lib.update_config(newConfig, config)
            config = newConfig

            // Check stores were cleared but properties are the same
            expect(document.cookie).toEqual('')
            expect(localStorage.getItem('ph__posthog')).toEqual(null)
            expect(lib.properties()).toEqual(expectedProps())

            // Swap to localStorage
            newConfig = makePostHogConfig('test', 'localStorage')
            lib.update_config(newConfig, config)
            config = newConfig

            // Check store contains data and props are the same
            expect(document.cookie).toEqual('')
            expect(localStorage.getItem('ph__posthog')).toEqual(JSON.stringify(expectedProps()))
            expect(lib.properties()).toEqual(expectedProps())
        })
    })

    describe('posthog', () => {
        it('should not store anything in localstorage, or cookies when in sessionStorage mode', () => {
            const token = uuidv7()
            const persistenceKey = `ph_${token}_posthog`
            const posthog = new PostHog().init(token, {
                persistence: 'sessionStorage',
            })
            posthog.register({ distinct_id: 'test', test_prop: 'test_val' })
            posthog.capture('test_event')
            expect(window.localStorage.getItem(persistenceKey)).toEqual(null)
            expect(document.cookie).toEqual('')
            expect(window.sessionStorage.getItem(persistenceKey)).toBeTruthy()
        })

        it('should not store anything in localstorage, sessionstorage, or cookies when in memory mode', () => {
            const token = uuidv7()
            const persistenceKey = `ph_${token}_posthog`
            const posthog = new PostHog().init(token, {
                persistence: 'memory',
            })
            posthog.register({ distinct_id: 'test', test_prop: 'test_val' })
            posthog.capture('test_event')
            expect(window.localStorage.getItem(persistenceKey)).toEqual(null)
            expect(window.sessionStorage.getItem(persistenceKey)).toEqual(null)
            expect(document.cookie).toEqual('')
        })

        it('should not store anything in cookies when in localstorage mode', () => {
            const token = uuidv7()
            const persistenceKey = `ph_${token}_posthog`
            const posthog = new PostHog().init(token, {
                persistence: 'localStorage',
            })
            posthog.register({ distinct_id: 'test', test_prop: 'test_val' })
            posthog.capture('test_event')
            expect(window.localStorage.getItem(persistenceKey)).toBeTruthy()
            expect(window.sessionStorage.getItem(persistenceKey)).toBeTruthy()
            expect(document.cookie).toEqual('')
        })
    })
})

describe('flag and survey storage split', () => {
    const MAIN = 'ph__posthog'
    const FLAGS = 'ph__posthog__flags'
    const SURVEYS_ENTRY = 'ph__posthog__surveys'

    const FLAG_CLUSTER: Record<string, any> = {
        [ENABLED_FEATURE_FLAGS]: { beta: true, exp: 'control' },
        [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['beta', 'exp'],
        [PERSISTENCE_FEATURE_FLAG_DETAILS]: { flags: { beta: { enabled: true } } },
        [PERSISTENCE_FEATURE_FLAG_PAYLOADS]: { beta: { k: 'v' } },
        [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: 'req-123',
        [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: 1717200000000,
    }
    const SURVEY_DATA: Record<string, any> = { [SURVEYS]: [{ id: 's1', name: 'NPS' }] }

    const parse = (key: string): any => JSON.parse(localStorage.getItem(key) || 'null')

    const makeConfig = (overrides: Partial<PostHogConfig> = {}): PostHogConfig =>
        ({
            ...makePostHogConfig('test', 'localStorage'),
            split_storage: true,
            ...overrides,
        }) as PostHogConfig

    const gateOffConfig = (): PostHogConfig => makePostHogConfig('test', 'localStorage')

    beforeEach(() => {
        resetLocalStorageSupported()
        resetSessionStorageSupported()
        localStorage.clear()
        document.cookie = ''
    })

    afterEach(() => {
        localStorage.clear()
        document.cookie = ''
    })

    describe('gate off (default) keeps current single-blob behaviour', () => {
        it('writes flag and survey keys into the single main blob, no group entries', () => {
            const lib = new PostHogPersistence(gateOffConfig())
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })

            expect(parse(FLAGS)).toBeNull()
            expect(parse(SURVEYS_ENTRY)).toBeNull()
            const main = parse(MAIN)
            expect(main[ENABLED_FEATURE_FLAGS]).toEqual(FLAG_CLUSTER[ENABLED_FEATURE_FLAGS])
            expect(main[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])
            expect(main['distinct_id']).toBe('d')
        })

        it('never writes to the group entries', () => {
            const setSpy = jest.spyOn(localStore, '_set')
            const lib = new PostHogPersistence(gateOffConfig())
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })

            const groupWrites = setSpy.mock.calls.filter(([name]) => name === FLAGS || name === SURVEYS_ENTRY)
            expect(groupWrites).toEqual([])
            setSpy.mockRestore()
        })
    })

    describe('gate on partitions into group entries', () => {
        it('writes the cluster to __flags, surveys to __surveys, strips both from main', () => {
            const lib = new PostHogPersistence(makeConfig())
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })

            const flags = parse(FLAGS)
            const surveys = parse(SURVEYS_ENTRY)
            const main = parse(MAIN)

            Object.entries(FLAG_CLUSTER).forEach(([k, v]) => expect(flags[k]).toEqual(v))
            expect(surveys[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])
            expect(main['distinct_id']).toBe('d')
            Object.keys(FLAG_CLUSTER).forEach((k) => expect(main[k]).toBeUndefined())
            expect(main[SURVEYS]).toBeUndefined()
            // flags and surveys live in different entries
            expect(flags[SURVEYS]).toBeUndefined()
            expect(surveys[ENABLED_FEATURE_FLAGS]).toBeUndefined()
        })

        it('round-trips all grouped values back into props on reload', () => {
            const lib = new PostHogPersistence(makeConfig())
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })

            const reloaded = new PostHogPersistence(makeConfig())
            Object.entries(FLAG_CLUSTER).forEach(([k, v]) => expect(reloaded.props[k]).toEqual(v))
            expect(reloaded.props[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])
            expect(reloaded.props['distinct_id']).toBe('d')
        })

        it('the whole flag cluster lands in __flags in a single write (atomic)', () => {
            const lib = new PostHogPersistence(makeConfig())
            lib.register({ distinct_id: 'd' })

            const setSpy = jest.spyOn(localStore, '_set')
            setSpy.mockClear()

            lib.register(FLAG_CLUSTER)

            const flagWrites = setSpy.mock.calls.filter(([name]) => name === FLAGS)
            expect(flagWrites).toHaveLength(1)
            const [, written] = flagWrites[0]
            Object.entries(FLAG_CLUSTER).forEach(([k, v]) => expect((written as any)[k]).toEqual(v))
            setSpy.mockRestore()
        })
    })

    describe('volatile metadata does not dirty the group entries', () => {
        // $feature_flag_evaluated_at, $feature_flag_request_id, and
        // $surveys_loaded_at change on every /flags (or /surveys) load even when
        // the meaningful content is unchanged. Rewriting a multi-hundred-KB group
        // entry just to refresh them re-broadcasts the payload to every open tab
        // on each SPA navigation — exactly the cross-tab storage-event pressure
        // the split exists to remove. A volatile-only change skips the write; the
        // freshest value rides along on the next content write.
        it.each([
            {
                label: '$feature_flag_evaluated_at',
                entry: FLAGS,
                register: { [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: 1717200099999 },
            },
            {
                label: '$feature_flag_request_id',
                entry: FLAGS,
                register: { [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: 'req-789' },
            },
            {
                label: '$surveys_loaded_at',
                entry: SURVEYS_ENTRY,
                register: { [SURVEYS_LOADED_AT]: 1717200099999 },
            },
        ])('registering only a fresh $label does not rewrite the group entry', ({ entry, register }) => {
            const lib = new PostHogPersistence(makeConfig())
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, [SURVEYS_LOADED_AT]: 1717200000000, distinct_id: 'd' })

            const setSpy = jest.spyOn(localStore, '_set')
            setSpy.mockClear()
            lib.register(register)

            expect(setSpy.mock.calls.map(([name]) => name)).not.toContain(entry)
            setSpy.mockRestore()
        })

        it('a content change writes the group entry with the freshest volatile values riding along', () => {
            const lib = new PostHogPersistence(makeConfig())
            lib.register({ ...FLAG_CLUSTER, distinct_id: 'd' })

            lib.register({ [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: 1717200099999 })
            expect(parse(FLAGS)[PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]).toEqual(1717200000000)

            lib.register({ [ENABLED_FEATURE_FLAGS]: { beta: false } })
            const flagsEntry = parse(FLAGS)
            expect(flagsEntry[ENABLED_FEATURE_FLAGS]).toEqual({ beta: false })
            expect(flagsEntry[PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]).toEqual(1717200099999)
        })

        it('the in-memory value is always the freshest even while disk lags', () => {
            const lib = new PostHogPersistence(makeConfig())
            lib.register({ ...FLAG_CLUSTER, distinct_id: 'd' })

            lib.register({ [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: 'req-789' })

            expect(lib.props[PERSISTENCE_FEATURE_FLAG_REQUEST_ID]).toEqual('req-789')
            expect(parse(FLAGS)[PERSISTENCE_FEATURE_FLAG_REQUEST_ID]).toEqual('req-123')
        })

        it('a returning visitor whose loads only refresh volatile values never rewrites the entry', () => {
            localStorage.setItem(MAIN, JSON.stringify({ distinct_id: 'd' }))
            localStorage.setItem(FLAGS, JSON.stringify(FLAG_CLUSTER))

            const lib = new PostHogPersistence(makeConfig())
            const setSpy = jest.spyOn(localStore, '_set')
            setSpy.mockClear()

            lib.register({
                [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: 1717200099999,
                [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: 'req-789',
            })

            expect(setSpy.mock.calls.map(([name]) => name)).not.toContain(FLAGS)
            setSpy.mockRestore()
        })
    })

    describe('per-entry fingerprints decouple the writes', () => {
        it('a main-blob change does not rewrite __flags or __surveys', () => {
            const lib = new PostHogPersistence(makeConfig())
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })

            const setSpy = jest.spyOn(localStore, '_set')
            setSpy.mockClear()

            lib.register({ distinct_id: 'd2' })

            const names = setSpy.mock.calls.map(([name]) => name)
            expect(names).toContain(MAIN)
            expect(names).not.toContain(FLAGS)
            expect(names).not.toContain(SURVEYS_ENTRY)
            setSpy.mockRestore()
        })

        it('a flag change rewrites only __flags', () => {
            const lib = new PostHogPersistence(makeConfig())
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })

            const setSpy = jest.spyOn(localStore, '_set')
            setSpy.mockClear()

            lib.register({ [ENABLED_FEATURE_FLAGS]: { beta: false, exp: 'test' } })

            const names = setSpy.mock.calls.map(([name]) => name)
            expect(names).toContain(FLAGS)
            expect(names).not.toContain(MAIN)
            expect(names).not.toContain(SURVEYS_ENTRY)
            setSpy.mockRestore()
        })

        // A returning visitor loads __flags from disk. The frequent main-blob
        // saves posthog fires at startup (before fresh flags return from the
        // network) must not rewrite — and so re-broadcast to every open tab —
        // the unchanged flag blob. Loading must seed the same fingerprint a
        // write produces, so the very first save recognises it as unchanged.
        //
        // The cookie-option setters (set_cross_subdomain / set_secure) fire once
        // each on construction as their in-memory option transitions from
        // undefined to its configured value. They must not churn the
        // localStorage-only group entries either, so the concrete-cookie-options
        // case (what posthog-core actually constructs with) is covered too.
        it.each([
            { label: 'cookie options unset', extra: {} },
            {
                label: 'concrete cookie options (production)',
                extra: { secure_cookie: true, cross_subdomain_cookie: false },
            },
        ])('a returning visitor does not rewrite the unchanged __flags it loaded ($label)', ({ extra }) => {
            localStorage.setItem(MAIN, JSON.stringify({ distinct_id: 'd' }))
            localStorage.setItem(FLAGS, JSON.stringify(FLAG_CLUSTER))

            const setSpy = jest.spyOn(localStore, '_set')
            const lib = new PostHogPersistence(makeConfig(extra))

            // construction must not have rewritten the entry it just loaded
            expect(setSpy.mock.calls.filter(([name]) => name === FLAGS)).toEqual([])

            setSpy.mockClear()
            lib.register({ distinct_id: 'd2' })

            const names = setSpy.mock.calls.map(([name]) => name)
            expect(names).toContain(MAIN)
            expect(names).not.toContain(FLAGS)
            setSpy.mockRestore()
        })

        // Same returning-visitor guarantee for the survey payload: an unchanged
        // __surveys loaded from disk must not be rewritten/re-broadcast by the
        // startup main-blob saves.
        it('a returning visitor does not rewrite the unchanged __surveys it loaded', () => {
            localStorage.setItem(MAIN, JSON.stringify({ distinct_id: 'd' }))
            localStorage.setItem(SURVEYS_ENTRY, JSON.stringify(SURVEY_DATA))

            const setSpy = jest.spyOn(localStore, '_set')
            const lib = new PostHogPersistence(makeConfig())

            expect(setSpy.mock.calls.filter(([name]) => name === SURVEYS_ENTRY)).toEqual([])

            setSpy.mockClear()
            lib.register({ distinct_id: 'd2' })

            const names = setSpy.mock.calls.map(([name]) => name)
            expect(names).toContain(MAIN)
            expect(names).not.toContain(SURVEYS_ENTRY)
            setSpy.mockRestore()
        })

        // The flip side of seeding: the seed must suppress only the redundant
        // first write, never a real subsequent flag change. A genuine mutation
        // goes through _setProp -> _markGroupDirty, which clears the fast-path, so
        // the changed cluster must still land in __flags after a seeded load.
        it('still rewrites __flags when a flag changes after a seeded load', () => {
            localStorage.setItem(MAIN, JSON.stringify({ distinct_id: 'd' }))
            localStorage.setItem(FLAGS, JSON.stringify(FLAG_CLUSTER))

            const lib = new PostHogPersistence(makeConfig())
            const setSpy = jest.spyOn(localStore, '_set')
            setSpy.mockClear()

            lib.register({ [ENABLED_FEATURE_FLAGS]: { beta: false, exp: 'control' } })

            expect(setSpy.mock.calls.map(([name]) => name)).toContain(FLAGS)
            expect(parse(FLAGS)[ENABLED_FEATURE_FLAGS]).toEqual({ beta: false, exp: 'control' })
            setSpy.mockRestore()
        })
    })

    describe('one-shot migration from the old main-blob location', () => {
        it('reads the old location once, then moves grouped keys out of main', () => {
            localStorage.setItem(MAIN, JSON.stringify({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' }))

            const lib = new PostHogPersistence(makeConfig())

            Object.entries(FLAG_CLUSTER).forEach(([k, v]) => expect(lib.props[k]).toEqual(v))
            expect(lib.props[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])

            const main = parse(MAIN)
            Object.keys(FLAG_CLUSTER).forEach((k) => expect(main[k]).toBeUndefined())
            expect(main[SURVEYS]).toBeUndefined()
            expect(main['distinct_id']).toBe('d')
            expect(parse(FLAGS)[ENABLED_FEATURE_FLAGS]).toEqual(FLAG_CLUSTER[ENABLED_FEATURE_FLAGS])
            expect(parse(SURVEYS_ENTRY)[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])
        })

        // Partial migration: __flags already exists on disk, but the main blob
        // still carries a flag-group key that __flags does not (an older SDK that
        // grouped fewer keys, or a gate-off / mixed-fleet tab that wrote a flag key
        // back to main). The leftover must end up in __flags, not be stripped from
        // main and lost — seeding the load fingerprint must not let the first save
        // skip this migration write.
        it('folds a main-blob leftover into __flags even when __flags already exists', () => {
            localStorage.setItem(FLAGS, JSON.stringify({ [ENABLED_FEATURE_FLAGS]: { beta: true } }))
            localStorage.setItem(
                MAIN,
                JSON.stringify({ [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: 'req-leftover', distinct_id: 'd' })
            )

            new PostHogPersistence(makeConfig())

            // the leftover is migrated into __flags and stripped from main
            expect(parse(FLAGS)[PERSISTENCE_FEATURE_FLAG_REQUEST_ID]).toBe('req-leftover')
            expect(parse(MAIN)[PERSISTENCE_FEATURE_FLAG_REQUEST_ID]).toBeUndefined()

            // a fresh reload still resolves it (proves it landed on disk, not just memory)
            const reloaded = new PostHogPersistence(makeConfig())
            expect(reloaded.props[PERSISTENCE_FEATURE_FLAG_REQUEST_ID]).toBe('req-leftover')
            expect(reloaded.props[ENABLED_FEATURE_FLAGS]).toEqual({ beta: true })
        })

        it('prefers the group entry over a stale value in the old main blob', () => {
            localStorage.setItem(MAIN, JSON.stringify({ [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: 'stale-main' }))
            localStorage.setItem(FLAGS, JSON.stringify({ [PERSISTENCE_FEATURE_FLAG_REQUEST_ID]: 'fresh-group' }))

            const lib = new PostHogPersistence(makeConfig())
            expect(lib.props[PERSISTENCE_FEATURE_FLAG_REQUEST_ID]).toBe('fresh-group')
        })
    })

    describe('downgrade / mixed fleet (transient miss, never wrong)', () => {
        it('a gate-off instance does not see grouped keys a gate-on instance split out', () => {
            const split = new PostHogPersistence(makeConfig())
            split.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })

            const old = new PostHogPersistence(gateOffConfig())
            Object.keys(FLAG_CLUSTER).forEach((k) => expect(old.props[k]).toBeUndefined())
            expect(old.props[SURVEYS]).toBeUndefined()
            expect(old.props['distinct_id']).toBe('d')
        })

        it('a live gate-off instance keeps its in-memory flags after a gate-on sibling strips main', () => {
            localStorage.setItem(MAIN, JSON.stringify({ ...FLAG_CLUSTER, distinct_id: 'd' }))

            const oldTab = new PostHogPersistence(gateOffConfig())
            expect(oldTab.props[ENABLED_FEATURE_FLAGS]).toEqual(FLAG_CLUSTER[ENABLED_FEATURE_FLAGS])

            // a newly-loaded gate-on tab migrates and strips flags from main
            new PostHogPersistence(makeConfig())
            expect(parse(MAIN)[ENABLED_FEATURE_FLAGS]).toBeUndefined()

            // the live old tab still has its in-memory copy (no storage listener re-reads)
            expect(oldTab.props[ENABLED_FEATURE_FLAGS]).toEqual(FLAG_CLUSTER[ENABLED_FEATURE_FLAGS])
        })
    })

    describe('reset / opt-out wipe every entry', () => {
        it('clear() removes the main blob and both group entries', () => {
            const lib = new PostHogPersistence(makeConfig())
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })
            expect(parse(FLAGS)).not.toBeNull()
            expect(parse(SURVEYS_ENTRY)).not.toBeNull()

            lib.clear()

            expect(parse(MAIN)).toBeNull()
            expect(parse(FLAGS)).toBeNull()
            expect(parse(SURVEYS_ENTRY)).toBeNull()
        })

        it('clear() removes orphaned group entries even when the gate is off', () => {
            localStorage.setItem(FLAGS, JSON.stringify(FLAG_CLUSTER))
            localStorage.setItem(SURVEYS_ENTRY, JSON.stringify(SURVEY_DATA))

            const lib = new PostHogPersistence(gateOffConfig())
            lib.clear()

            expect(parse(FLAGS)).toBeNull()
            expect(parse(SURVEYS_ENTRY)).toBeNull()
        })
    })

    describe('storage backends', () => {
        it('localStorage+cookie writes group entries to localStorage only, never the cookie', () => {
            const lib = new PostHogPersistence(makeConfig({ persistence: 'localStorage+cookie' }))
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })

            expect(parse(FLAGS)[ENABLED_FEATURE_FLAGS]).toEqual(FLAG_CLUSTER[ENABLED_FEATURE_FLAGS])
            expect(parse(SURVEYS_ENTRY)[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])
            expect(document.cookie).not.toContain('__flags')
            expect(document.cookie).not.toContain('__surveys')
            expect(document.cookie).not.toContain('feature_flag')
        })

        it.each(['memory', 'sessionStorage', 'cookie'])(
            '%s backend keeps the single blob even with the gate on',
            (mode) => {
                const lib = new PostHogPersistence(makeConfig({ persistence: mode as PostHogConfig['persistence'] }))
                lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })

                expect(parse(FLAGS)).toBeNull()
                expect(parse(SURVEYS_ENTRY)).toBeNull()
                expect(lib.props[ENABLED_FEATURE_FLAGS]).toEqual(FLAG_CLUSTER[ENABLED_FEATURE_FLAGS])
                expect(lib.props[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])
            }
        )
    })

    describe('overrides stay in the main blob', () => {
        it('feature flag overrides are not split out', () => {
            const lib = new PostHogPersistence(makeConfig())
            lib.register({ [PERSISTENCE_OVERRIDE_FEATURE_FLAGS]: { beta: false }, ...FLAG_CLUSTER })

            expect(parse(MAIN)[PERSISTENCE_OVERRIDE_FEATURE_FLAGS]).toEqual({ beta: false })
            expect(parse(FLAGS)[PERSISTENCE_OVERRIDE_FEATURE_FLAGS]).toBeUndefined()
        })
    })

    describe('refreshKey is group-aware', () => {
        it('pulls a grouped key from the __flags entry', () => {
            const lib = new PostHogPersistence(makeConfig())
            lib.register({ ...FLAG_CLUSTER, distinct_id: 'd' })

            const flags = parse(FLAGS)
            flags[PERSISTENCE_FEATURE_FLAG_REQUEST_ID] = 'req-from-sibling'
            localStorage.setItem(FLAGS, JSON.stringify(flags))

            lib.refreshKey(PERSISTENCE_FEATURE_FLAG_REQUEST_ID)
            expect(lib.props[PERSISTENCE_FEATURE_FLAG_REQUEST_ID]).toBe('req-from-sibling')
        })

        it('falls back to the un-migrated main blob for a grouped key absent from __flags', () => {
            const lib = new PostHogPersistence(makeConfig())
            localStorage.setItem(FLAGS, JSON.stringify({}))
            const main = parse(MAIN) || {}
            main[PERSISTENCE_FEATURE_FLAG_REQUEST_ID] = 'from-old-main'
            localStorage.setItem(MAIN, JSON.stringify(main))

            lib.refreshKey(PERSISTENCE_FEATURE_FLAG_REQUEST_ID)
            expect(lib.props[PERSISTENCE_FEATURE_FLAG_REQUEST_ID]).toBe('from-old-main')
        })

        it('deletes a grouped key absent from both __flags and main', () => {
            const lib = new PostHogPersistence(makeConfig())
            lib.props[PERSISTENCE_FEATURE_FLAG_REQUEST_ID] = 'stale'
            localStorage.setItem(FLAGS, JSON.stringify({}))
            const main = parse(MAIN) || {}
            delete main[PERSISTENCE_FEATURE_FLAG_REQUEST_ID]
            localStorage.setItem(MAIN, JSON.stringify(main))

            lib.refreshKey(PERSISTENCE_FEATURE_FLAG_REQUEST_ID)
            expect(lib.props[PERSISTENCE_FEATURE_FLAG_REQUEST_ID]).toBeUndefined()
        })
    })

    describe('runtime toggle of the gate via update_config', () => {
        // The split routing must follow `split_storage`
        // even when it flips without a persistence change.
        it('turning the gate on migrates flag/survey keys out of the main blob', () => {
            const off = gateOffConfig()
            const lib = new PostHogPersistence(off)
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })
            expect(parse(FLAGS)).toBeNull()
            expect(parse(MAIN)[ENABLED_FEATURE_FLAGS]).toEqual(FLAG_CLUSTER[ENABLED_FEATURE_FLAGS])

            lib.update_config(makeConfig(), off)

            expect(parse(FLAGS)[ENABLED_FEATURE_FLAGS]).toEqual(FLAG_CLUSTER[ENABLED_FEATURE_FLAGS])
            expect(parse(SURVEYS_ENTRY)[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])
            const main = parse(MAIN)
            Object.keys(FLAG_CLUSTER).forEach((k) => expect(main[k]).toBeUndefined())
            expect(main[SURVEYS]).toBeUndefined()
            expect(main['distinct_id']).toBe('d')
        })

        it('turning the gate off folds grouped keys back into main and drops the group entries', () => {
            const on = makeConfig()
            const lib = new PostHogPersistence(on)
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })
            expect(parse(FLAGS)).not.toBeNull()

            lib.update_config(gateOffConfig(), on)

            expect(parse(FLAGS)).toBeNull()
            expect(parse(SURVEYS_ENTRY)).toBeNull()
            const main = parse(MAIN)
            expect(main[ENABLED_FEATURE_FLAGS]).toEqual(FLAG_CLUSTER[ENABLED_FEATURE_FLAGS])
            expect(main[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])
        })

        it('keeps in-memory props intact across the toggle', () => {
            const off = gateOffConfig()
            const lib = new PostHogPersistence(off)
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })

            lib.update_config(makeConfig(), off)

            Object.entries(FLAG_CLUSTER).forEach(([k, v]) => expect(lib.props[k]).toEqual(v))
            expect(lib.props[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])
            expect(lib.props['distinct_id']).toBe('d')
        })

        // update_config can move to a backend that can't host the split
        // (localStorage -> memory) while the gate stays on. Eligibility must
        // re-resolve to "off" so the grouped keys fold back into the single blob
        // instead of being stranded in orphaned __flags / __surveys entries.
        it('drops the split when the backend becomes ineligible while the gate stays on', () => {
            const on = makeConfig()
            const lib = new PostHogPersistence(on)
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })
            expect(parse(FLAGS)).not.toBeNull()
            expect(parse(SURVEYS_ENTRY)).not.toBeNull()

            // still split_storage: true, but memory cannot host the split
            lib.update_config(makeConfig({ persistence: 'memory' }), on)

            expect((lib as any)._splitStorage).toBe(false)
            expect(parse(FLAGS)).toBeNull()
            expect(parse(SURVEYS_ENTRY)).toBeNull()
            // the grouped keys fold back into the (single) blob in memory, not stranded
            Object.entries(FLAG_CLUSTER).forEach(([k, v]) => expect(lib.props[k]).toEqual(v))
            expect(lib.props[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])
            expect(lib.props['distinct_id']).toBe('d')
        })

        // The reverse: starting on a backend that can't host the split (memory),
        // moving to localStorage with the gate on must adopt the split and migrate
        // the grouped keys out of the single blob into __flags / __surveys.
        it('adopts the split when the backend becomes eligible while the gate stays on', () => {
            const onMemory = makeConfig({ persistence: 'memory' })
            const lib = new PostHogPersistence(onMemory)
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })
            expect((lib as any)._splitStorage).toBe(false)
            expect(parse(FLAGS)).toBeNull()
            expect(parse(SURVEYS_ENTRY)).toBeNull()

            lib.update_config(makeConfig(), onMemory)

            expect((lib as any)._splitStorage).toBe(true)
            expect(parse(FLAGS)[ENABLED_FEATURE_FLAGS]).toEqual(FLAG_CLUSTER[ENABLED_FEATURE_FLAGS])
            expect(parse(SURVEYS_ENTRY)[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])
            const main = parse(MAIN)
            Object.keys(FLAG_CLUSTER).forEach((k) => expect(main[k]).toBeUndefined())
            expect(main[SURVEYS]).toBeUndefined()
            expect(main['distinct_id']).toBe('d')
            Object.entries(FLAG_CLUSTER).forEach(([k, v]) => expect(lib.props[k]).toEqual(v))
            expect(lib.props[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])
        })

        // A full round-trip across the eligibility boundary in both directions
        // must never strand the grouped keys: they follow the in-memory props the
        // whole way and land back in __flags / __surveys once the backend can host
        // the split again.
        it('round-trips grouped keys across localStorage -> memory -> localStorage without stranding them', () => {
            const onLocal = makeConfig()
            const lib = new PostHogPersistence(onLocal)
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })
            expect(parse(FLAGS)).not.toBeNull()
            expect(parse(SURVEYS_ENTRY)).not.toBeNull()

            // -> memory: split drops, grouped keys fold into the single blob
            const onMemory = makeConfig({ persistence: 'memory' })
            lib.update_config(onMemory, onLocal)
            expect((lib as any)._splitStorage).toBe(false)
            expect(parse(FLAGS)).toBeNull()
            expect(parse(SURVEYS_ENTRY)).toBeNull()
            Object.entries(FLAG_CLUSTER).forEach(([k, v]) => expect(lib.props[k]).toEqual(v))
            expect(lib.props[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])

            // -> localStorage: split re-adopts, grouped keys migrate back out
            lib.update_config(onLocal, onMemory)
            expect((lib as any)._splitStorage).toBe(true)
            expect(parse(FLAGS)[ENABLED_FEATURE_FLAGS]).toEqual(FLAG_CLUSTER[ENABLED_FEATURE_FLAGS])
            expect(parse(SURVEYS_ENTRY)[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])
            Object.entries(FLAG_CLUSTER).forEach(([k, v]) => expect(lib.props[k]).toEqual(v))
            expect(lib.props[SURVEYS]).toEqual(SURVEY_DATA[SURVEYS])
            expect(lib.props['distinct_id']).toBe('d')
        })
    })

    describe('empty group entries are not eagerly created', () => {
        it('a gate-on instance with no flag/survey data writes only the main blob', () => {
            const setSpy = jest.spyOn(localStore, '_set')
            const lib = new PostHogPersistence(makeConfig())
            lib.register({ distinct_id: 'd' })

            expect(parse(MAIN)['distinct_id']).toBe('d')
            expect(parse(FLAGS)).toBeNull()
            expect(parse(SURVEYS_ENTRY)).toBeNull()
            const groupWrites = setSpy.mock.calls.filter(([name]) => name === FLAGS || name === SURVEYS_ENTRY)
            expect(groupWrites).toEqual([])
            setSpy.mockRestore()
        })

        it('writes a group entry through to empty once it has held data', () => {
            const lib = new PostHogPersistence(makeConfig())
            lib.register({ ...FLAG_CLUSTER, distinct_id: 'd' })
            expect(parse(FLAGS)[ENABLED_FEATURE_FLAGS]).toEqual(FLAG_CLUSTER[ENABLED_FEATURE_FLAGS])

            Object.keys(FLAG_CLUSTER).forEach((k) => lib.unregister(k))

            expect(parse(FLAGS)).toEqual({})
        })

        it('clears a pre-existing group entry emptied within the debounce window', () => {
            jest.useFakeTimers()
            try {
                localStorage.setItem(FLAGS, JSON.stringify(FLAG_CLUSTER))

                const lib = new PostHogPersistence(makeConfig({ persistence_save_debounce_ms: 250 }))
                Object.keys(FLAG_CLUSTER).forEach((k) => lib.unregister(k))
                jest.advanceTimersByTime(250)

                expect(parse(FLAGS)).toEqual({})
            } finally {
                jest.runOnlyPendingTimers()
                jest.useRealTimers()
            }
        })
    })

    describe('the session-scoped sibling must not wipe the localStorage owner', () => {
        // posthog-core runs a second, sessionStorage-backed PostHogPersistence that
        // shares the main instance's storage name. set_config reconstructs it, and a
        // fresh instance's update_config -> set_secure calls remove() — which must not
        // delete the localStorage owner's __flags / __surveys entries.
        it('set_config leaves the owner __flags and __surveys entries intact', () => {
            const token = uuidv7()
            const ownerFlags = `ph_${token}_posthog__flags`
            const ownerSurveys = `ph_${token}_posthog__surveys`
            const posthog = new PostHog().init(token, {
                persistence: 'localStorage+cookie',
                split_storage: true,
                secure_cookie: false,
            })
            posthog.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })
            expect(parse(ownerFlags)).not.toBeNull()
            expect(parse(ownerSurveys)).not.toBeNull()

            posthog.set_config({})

            expect(parse(ownerFlags)).not.toBeNull()
            expect(parse(ownerSurveys)).not.toBeNull()
        })

        // The set_config path above is saved by `keepGroupEntries` on the cookie
        // setters, so it would still pass if the `_ownsSplitStorage` guard were
        // deleted. This case makes that guard load-bearing: a non-owning sibling
        // that gets disabled fires a *bare* remove() (no keepGroupEntries), and
        // only `_ownsSplitStorage` stops it wiping the owner's localStorage entry.
        it('a disabled non-owning sibling does not wipe the owner __flags entry', () => {
            const owner = new PostHogPersistence(makeConfig())
            owner.register({ ...FLAG_CLUSTER, distinct_id: 'd' })
            expect(parse(FLAGS)).not.toBeNull()

            // mirrors the sessionStorage instance posthog-core spins up: shares the
            // storage name, but ownsSplitStorage=false (third constructor arg)
            const sibling = new PostHogPersistence({ ...makeConfig(), persistence: 'sessionStorage' }, false, false)
            sibling.set_disabled(true)

            expect(parse(FLAGS)).not.toBeNull()
        })
    })

    describe('a swallowed group write is retried, not cached as saved', () => {
        it('retries the __flags write on the next save after a failed (swallowed) write', () => {
            const lib = new PostHogPersistence(makeConfig())
            const realSet = localStore._set.bind(localStore)
            let failFlags = true
            jest.spyOn(localStore, '_set').mockImplementation((name, value, expire, cross, secure, debug) => {
                if (name === FLAGS && failFlags) {
                    return false // simulate a swallowed quota failure scoped to the flags entry
                }
                return realSet(name, value, expire, cross, secure, debug)
            })

            lib.register({ ...FLAG_CLUSTER, distinct_id: 'd' })
            // the failed write did not land, and the main blob is unaffected
            expect(parse(FLAGS)).toBeNull()
            expect(parse(MAIN)['distinct_id']).toBe('d')
            // a failed write must not mark the group as materialized on disk
            expect(!!(lib as any)._slotState['flags']?.persisted).toBe(false)

            // the entry is still dirty / un-fingerprinted, so the next save retries it
            failFlags = false
            lib.save()

            expect(parse(FLAGS)[ENABLED_FEATURE_FLAGS]).toEqual(FLAG_CLUSTER[ENABLED_FEATURE_FLAGS])
            // only after the confirmed write is it recorded as persisted
            expect(!!(lib as any)._slotState['flags']?.persisted).toBe(true)
            jest.restoreAllMocks()
        })
    })

    describe('a main-blob change does not re-serialize the unchanged group payloads', () => {
        it('skips JSON.stringify of __flags / __surveys when only a main key changed', () => {
            const lib = new PostHogPersistence(makeConfig())
            lib.register({ ...FLAG_CLUSTER, ...SURVEY_DATA, distinct_id: 'd' })

            const stringifySpy = jest.spyOn(JSON, 'stringify')
            lib.register({ distinct_id: 'd2' })

            const serializedAGroupPayload = stringifySpy.mock.calls.some(
                ([arg]) => arg && typeof arg === 'object' && (ENABLED_FEATURE_FLAGS in arg || SURVEYS in arg)
            )
            expect(serializedAGroupPayload).toBe(false)
            jest.restoreAllMocks()
        })
    })

    describe('a stale group entry does not overwrite a fresher main blob', () => {
        const olderTs = 1000
        const newerTs = 2000

        // flags carry $feature_flag_evaluated_at, so freshness is compared by
        // timestamp; an equal timestamp keeps the group entry (the canonical
        // migrated-forward home).
        it.each([
            { name: 'group older than main -> main wins', mainTs: newerTs, groupTs: olderTs, expectedBeta: 'main' },
            { name: 'group newer than main -> group wins', mainTs: olderTs, groupTs: newerTs, expectedBeta: 'group' },
            { name: 'equal timestamps -> group wins', mainTs: newerTs, groupTs: newerTs, expectedBeta: 'group' },
        ])('flags: $name', ({ mainTs, groupTs, expectedBeta }) => {
            localStorage.setItem(
                MAIN,
                JSON.stringify({
                    [ENABLED_FEATURE_FLAGS]: { beta: 'main' },
                    [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: mainTs,
                    distinct_id: 'd',
                })
            )
            localStorage.setItem(
                FLAGS,
                JSON.stringify({
                    [ENABLED_FEATURE_FLAGS]: { beta: 'group' },
                    [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: groupTs,
                })
            )

            const lib = new PostHogPersistence(makeConfig())
            expect(lib.props[ENABLED_FEATURE_FLAGS]).toEqual({ beta: expectedBeta })
        })

        // The freshness comparison only flips to the main blob when BOTH sides
        // carry a numeric stamp and main's is strictly newer (the `isNumber`
        // guards in `_groupEntryIsStale`). A missing stamp — an older SDK, or a
        // write from before the timestamp existed — must keep the group entry as
        // the canonical migrated-forward home, never silently lose to an
        // undefined. Without this the cached flags would quietly change.
        const flagsBeta = (beta: string): Record<string, any> => ({ [ENABLED_FEATURE_FLAGS]: { beta } })
        const flagStamp = { [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: newerTs }
        it.each([
            { name: 'main omits the stamp', main: flagsBeta('main'), group: { ...flagsBeta('group'), ...flagStamp } },
            { name: 'group omits the stamp', main: { ...flagsBeta('main'), ...flagStamp }, group: flagsBeta('group') },
            { name: 'neither side carries a stamp', main: flagsBeta('main'), group: flagsBeta('group') },
        ])('flags: the group entry wins when $name', ({ main, group }) => {
            localStorage.setItem(MAIN, JSON.stringify({ ...main, distinct_id: 'd' }))
            localStorage.setItem(FLAGS, JSON.stringify(group))

            const lib = new PostHogPersistence(makeConfig())
            expect(lib.props[ENABLED_FEATURE_FLAGS]).toEqual({ beta: 'group' })
        })

        // Surveys stamp $surveys_loaded_at on every /surveys fetch, so the same
        // freshness comparison applies: a stale __surveys entry no longer wins
        // over a fresher write-back left in the main blob.
        it.each([
            { name: 'group older than main -> main wins', mainTs: newerTs, groupTs: olderTs, expectedId: 'main' },
            { name: 'group newer than main -> group wins', mainTs: olderTs, groupTs: newerTs, expectedId: 'group' },
            { name: 'equal timestamps -> group wins', mainTs: newerTs, groupTs: newerTs, expectedId: 'group' },
        ])('surveys: $name', ({ mainTs, groupTs, expectedId }) => {
            localStorage.setItem(
                MAIN,
                JSON.stringify({ [SURVEYS]: [{ id: 'main' }], [SURVEYS_LOADED_AT]: mainTs, distinct_id: 'd' })
            )
            localStorage.setItem(
                SURVEYS_ENTRY,
                JSON.stringify({ [SURVEYS]: [{ id: 'group' }], [SURVEYS_LOADED_AT]: groupTs })
            )

            const lib = new PostHogPersistence(makeConfig())
            expect(lib.props[SURVEYS]).toEqual([{ id: expectedId }])
        })

        // Same isNumber-guard coverage as flags, for the surveys freshness key: a
        // missing $surveys_loaded_at on either side (a pre-freshness-stamp SDK, or
        // a write from before the stamp existed) must keep the group entry as the
        // canonical migrated-forward home, never silently lose to an undefined.
        const surveyRows = (id: string): Record<string, any> => ({ [SURVEYS]: [{ id }] })
        const surveyStamp = { [SURVEYS_LOADED_AT]: newerTs }
        it.each([
            {
                name: 'main omits the stamp',
                main: surveyRows('main'),
                group: { ...surveyRows('group'), ...surveyStamp },
            },
            {
                name: 'group omits the stamp',
                main: { ...surveyRows('main'), ...surveyStamp },
                group: surveyRows('group'),
            },
            { name: 'neither side carries a stamp', main: surveyRows('main'), group: surveyRows('group') },
        ])('surveys: the group entry wins when $name', ({ main, group }) => {
            localStorage.setItem(MAIN, JSON.stringify({ ...main, distinct_id: 'd' }))
            localStorage.setItem(SURVEYS_ENTRY, JSON.stringify(group))

            const lib = new PostHogPersistence(makeConfig())
            expect(lib.props[SURVEYS]).toEqual([{ id: 'group' }])
        })

        // The stale orphan must not just lose in memory — the first save has to
        // heal the on-disk __flags with the fresher main payload. Seeding the load
        // fingerprint must not let the group fast-path skip that heal write.
        it('heals a stale __flags entry on disk from the fresher main blob', () => {
            localStorage.setItem(
                MAIN,
                JSON.stringify({
                    [ENABLED_FEATURE_FLAGS]: { beta: 'fresh-main' },
                    [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: newerTs,
                    distinct_id: 'd',
                })
            )
            localStorage.setItem(
                FLAGS,
                JSON.stringify({
                    [ENABLED_FEATURE_FLAGS]: { beta: 'stale-group' },
                    [PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]: olderTs,
                })
            )

            new PostHogPersistence(makeConfig())

            expect(parse(FLAGS)[ENABLED_FEATURE_FLAGS]).toEqual({ beta: 'fresh-main' })
            const reloaded = new PostHogPersistence(makeConfig())
            expect(reloaded.props[ENABLED_FEATURE_FLAGS]).toEqual({ beta: 'fresh-main' })
        })
    })
})

describe('posthog instance persistence', () => {
    beforeEach(() => {
        resetSessionStorageSupported()
        resetLocalStorageSupported()
    })
    it('should not write to storage if opt_out_persistence_by_default and opt_out_capturing_by_default is true', () => {
        const sessionSpy = jest.spyOn(sessionStore, '_set')

        // init posthog while opting out
        const posthog = defaultPostHog().init(
            uuidv7(),
            {
                opt_out_persistence_by_default: true,
                opt_out_capturing_by_default: true,
                persistence: 'localStorage+cookie',
            },
            uuidv7()
        )

        // Spy on the created store instance's _set method
        // Note: We spy after initialization, so we're checking that no further calls are made
        const createdStore = (posthog.persistence as any)._storage
        const localPlusCookieSpy = jest.spyOn(createdStore, '_set')

        // we do one call to check if session storage is supported, but don't actually store anything
        // the important thing is that we don't store the session id or window id, etc. This test was added alongside
        // a fix which prevented this
        const sessionCalls = sessionSpy.mock.calls.filter(([key]) => key !== '__support__')

        // Check that no calls were made to the created store (spy captures future calls)
        const localPlusCookieCalls = localPlusCookieSpy.mock.calls.filter(([key]) => key !== '__support__')

        expect(sessionCalls).toEqual([])
        expect(localPlusCookieCalls).toEqual([])
    })

    it('should write to storage if opt_out_persistence_by_default and opt_out_capturing_by_default is false', () => {
        const sessionSpy = jest.spyOn(sessionStore, '_set')

        // init posthog while opting out
        const posthog = defaultPostHog().init(
            uuidv7(),
            {
                opt_out_persistence_by_default: false,
                opt_out_capturing_by_default: false,
                persistence: 'localStorage+cookie',
            },
            uuidv7()
        )

        // Spy on the created store instance's _set method
        const createdStore = (posthog.persistence as any)._storage
        const localPlusCookieSpy = jest.spyOn(createdStore, '_set')

        // Trigger a save to verify storage is called. We force a real
        // state change because save() now no-ops identical writes.
        if (posthog.persistence) {
            posthog.persistence.register({ verify_write: 'yes' })
        }

        const sessionCalls = sessionSpy.mock.calls.filter(([key]) => key !== '__support__')
        const localPlusCookieCalls = localPlusCookieSpy.mock.calls.filter(([key]) => key !== '__support__')

        expect(sessionCalls.length).toBeGreaterThan(0)
        expect(localPlusCookieCalls.length).toBeGreaterThan(0)
    })
})

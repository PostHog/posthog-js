/// <reference lib="dom" />
import { PostHogPersistence } from '../posthog-persistence'
import {
    DEVICE_ID,
    ENABLED_FEATURE_FLAGS,
    INITIAL_PERSON_INFO,
    PERSISTENCE_FEATURE_FLAG_PAYLOADS,
    PERSISTENCE_OVERRIDE_FEATURE_FLAG_PAYLOADS,
    PRODUCT_TOURS,
    PRODUCT_TOURS_ACTIVATED,
    SESSION_ID,
    SESSION_RECORDING_REMOTE_CONFIG,
    SESSION_RECORDING_TRIGGER_V2_GROUP_EVENT_PREFIX,
    SURVEYS_ACTIVATED,
    USER_STATE,
} from '../constants'
import { PERSISTENCE_KEY_POLICY } from '../persistence-key-policy'
import { PostHogConfig } from '../types'
import { PostHog } from '../posthog-core'
import { window } from '../utils/globals'
import { uuidv7 } from '../uuidv7'
import { cookieStore, resetLocalStorageSupported, resetSessionStorageSupported, sessionStore } from '../storage'
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
    '$flag_call_reported',
    '$flag_call_reported_session_id',
    '$feature_flag_errors',
    '$feature_flag_evaluated_at',
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
                // the timer, clears _lastSavedSerialized, deletes storage.
                // Then the unload listener fires flush(). Without the
                // pending-timer guard, flush() would call _writeNow() with
                // props={}, mismatch against undefined _lastSavedSerialized,
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

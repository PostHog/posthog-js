/* eslint camelcase: "off" */

import { each, extend, stripEmptyProperties, addEventListener } from './utils'
import { cookieStore, createLocalPlusCookieStore, localStore, memoryStore, sessionStore } from './storage'
import { PersistentStore, PostHogConfig, Properties } from './types'
import { window } from './utils/globals'
import {
    ENABLED_FEATURE_FLAGS,
    EVENT_TIMERS_KEY,
    INITIAL_CAMPAIGN_PARAMS,
    INITIAL_PERSON_INFO,
    INITIAL_REFERRER_INFO,
    PERSISTENCE_FEATURE_FLAG_EVALUATED_AT,
} from './constants'
import { getPersistenceKeyPolicy } from './persistence-key-policy'

import { isNumber, isUndefined } from '@posthog/core'
import {
    getCampaignParams,
    getInitialPersonPropsFromInfo,
    getPersonInfo,
    getReferrerInfo,
    getSearchInfo,
} from './utils/event-utils'
import { logger } from './utils/logger'
import { stripLeadingDollar, isEmptyObject, isObject } from '@posthog/core'

const CASE_INSENSITIVE_PERSISTENCE_TYPES: readonly Lowercase<PostHogConfig['persistence']>[] = [
    'cookie',
    'localstorage',
    'localstorage+cookie',
    'sessionstorage',
    'memory',
]

const parseName = (config: PostHogConfig): string => {
    let token = ''
    if (config['token']) {
        token = config['token'].replace(/\+/g, 'PL').replace(/\//g, 'SL').replace(/=/g, 'EQ')
    }

    if (config['persistence_name']) {
        return 'ph_' + config['persistence_name']
    } else {
        return 'ph_' + token + '_posthog'
    }
}

const isArrayContentsEqual = (arr1: readonly string[], arr2: readonly string[]): boolean => {
    if (arr1.length !== arr2.length) {
        return false
    }

    const sortedArr1 = [...arr1].sort()
    const sortedArr2 = [...arr2].sort()
    return sortedArr1.every((item, index) => item === sortedArr2[index])
}

/**
 * PostHog Persistence Object
 * @constructor
 */
export class PostHogPersistence {
    private _config: PostHogConfig
    props: Properties
    private _storage: PersistentStore
    private _campaign_params_saved: boolean
    private readonly _name: string
    _disabled: boolean | undefined
    private _secure: boolean | undefined
    private _expire_days: number | undefined
    private _default_expiry: number | undefined
    private _cross_subdomain: boolean | undefined
    // Serialized snapshot of `props` from the most recent successful write.
    // Used by `_writeNow()` to skip writes that would produce an identical
    // payload. Cleared whenever we explicitly remove the storage entry, so
    // a save after remove always lands.
    private _lastSavedSerialized: string | undefined
    // Optional debounce: when `persistence_save_debounce_ms` is > 0, rapid
    // calls to `save()` are coalesced into one write at the end of the
    // window. The in-memory `props` is always updated synchronously, so
    // in-tab reads see the latest values regardless. Pending writes are
    // flushed on `beforeunload` and `pagehide` so no state is lost on
    // tab close.
    private _pendingSaveTimer: ReturnType<typeof setTimeout> | undefined

    /**
     * @param {PostHogConfig} config initial PostHog configuration
     * @param {boolean=} isDisabled should persistence be disabled (e.g. because of consent management)
     */
    constructor(config: PostHogConfig, isDisabled?: boolean) {
        this._config = config
        this.props = {}
        this._campaign_params_saved = false
        this._name = parseName(config)
        this._storage = this._buildStorage(config)
        this.load()
        if (config.debug) {
            logger.info('Persistence loaded', config['persistence'], { ...this.props })
        }
        this.update_config(config, config, isDisabled)
        this.save()

        // Install unload flush listeners unconditionally. They are a no-op
        // when no debounced write is pending (see `flush()`), so it is safe
        // to install even when `persistence_save_debounce_ms` is 0 at
        // construction. Crucially this also handles `posthog.set_config({
        // persistence_save_debounce_ms: 250 })` enabling debounce later —
        // we'd otherwise miss the listener install and lose pending writes
        // on close.
        if (window) {
            const flush = (): void => this.flush()
            addEventListener(window, 'beforeunload', flush as EventListener, { capture: false })
            addEventListener(window, 'pagehide', flush as EventListener, { capture: false })
        }
    }

    private _saveDebounceMs(): number {
        const value = this._config?.persistence_save_debounce_ms
        return isNumber(value) && value > 0 ? value : 0
    }

    /**
     * Returns whether persistence is disabled. Only available in SDKs > 1.257.1. Do not use on extensions, otherwise
     * it'll break backwards compatibility for any version before 1.257.1.
     */
    public isDisabled?(): boolean {
        return !!this._disabled
    }

    private _buildStorage(config: PostHogConfig) {
        if (
            CASE_INSENSITIVE_PERSISTENCE_TYPES.indexOf(
                config['persistence'].toLowerCase() as Lowercase<PostHogConfig['persistence']>
            ) === -1
        ) {
            logger.critical(
                'Unknown persistence type ' + config['persistence'] + '; falling back to localStorage+cookie'
            )
            config['persistence'] = 'localStorage+cookie'
        }

        // Create this before hand to avoid creating it multiple times
        // Creating it inside each individual condition below is too complicated and will break backwards compatibility
        // so create it once for this specific config and use it if necessary
        const localPlusCookieStore = createLocalPlusCookieStore(config['cookie_persisted_properties'] || [])

        let store: PersistentStore

        // We handle storage type in a case-insensitive way for backwards compatibility
        const storage_type = config['persistence'].toLowerCase() as Lowercase<PostHogConfig['persistence']>
        if (storage_type === 'localstorage' && localStore._is_supported()) {
            store = localStore
        } else if (storage_type === 'localstorage+cookie' && localPlusCookieStore._is_supported()) {
            store = localPlusCookieStore
        } else if (storage_type === 'sessionstorage' && sessionStore._is_supported()) {
            store = sessionStore
        } else if (storage_type === 'memory') {
            store = memoryStore
        } else if (storage_type === 'cookie') {
            store = cookieStore
        } else if (localPlusCookieStore._is_supported()) {
            // selected storage type wasn't supported, fallback to 'localstorage+cookie' if possible
            store = localPlusCookieStore
        } else {
            store = cookieStore
        }

        return store
    }

    /**
     * Check if the feature flag cache is stale based on the configured TTL.
     * @param ttl Optional TTL override (uses config value if not provided)
     * @internal
     */
    _isFeatureFlagCacheStale(ttl?: number): boolean {
        const effectiveTtl = ttl ?? this._config.feature_flag_cache_ttl_ms
        if (!effectiveTtl || effectiveTtl <= 0) {
            return false
        }
        const evaluatedAt = this.props[PERSISTENCE_FEATURE_FLAG_EVALUATED_AT]
        // If evaluatedAt is missing or not a numeric timestamp, consider cache stale.
        // This handles SDK upgrades where old cached flags lack evaluatedAt.
        if (!evaluatedAt || typeof evaluatedAt !== 'number') {
            return true
        }
        return Date.now() - evaluatedAt > effectiveTtl
    }

    properties(): Properties {
        const p: Properties = {}

        each(this.props, (v, k) => {
            const policy = getPersistenceKeyPolicy(k)

            if (policy?.exposure === 'derived') {
                const shouldSkip = k === ENABLED_FEATURE_FLAGS ? () => this._isFeatureFlagCacheStale() : () => false

                if (policy.shouldSkipFromEventProperties?.(v, shouldSkip)) {
                    return
                }

                if (policy.transformToEventProperties) {
                    extend(p, policy.transformToEventProperties(v))
                }
            } else if (!policy || policy.exposure === 'event') {
                // Unknown keys are treated as user-defined super properties and remain event-visible.
                p[k] = v
            }
        })
        return p
    }

    load(): void {
        if (this._disabled) {
            return
        }

        const entry = this._storage._parse(this._name)

        if (entry) {
            this.props = extend({}, entry)
        }
    }

    /**
     * NOTE: Saving frequently causes issues with Recordings and Consent Management Platform (CMP) tools which
     * observe cookie changes, and modify their UI, often causing infinite loops.
     * As such callers of this should ideally check that the data has changed beforehand
     */
    save(): void {
        if (this._disabled) {
            return
        }

        const debounce = this._saveDebounceMs()
        if (debounce <= 0) {
            this._writeNow()
            return
        }
        // Coalesce: if a flush is already scheduled, the latest `props`
        // will be picked up when the timer fires. Otherwise schedule one.
        if (!isUndefined(this._pendingSaveTimer)) {
            return
        }
        this._pendingSaveTimer = setTimeout(() => {
            this._pendingSaveTimer = undefined
            this._writeNow()
        }, debounce)
    }

    /**
     * Force any pending debounced save to land in storage immediately.
     * No-op when there is no pending timer — crucially, this means the
     * `beforeunload` / `pagehide` listeners installed in the constructor
     * cannot accidentally resurrect a storage entry that `remove()` or
     * `clear()` just deleted. Without this guard, the listener would
     * call `_writeNow()` and write the in-memory `props` (now `{}`) back
     * to storage, breaking `posthog.reset()` / opt-out flows.
     */
    flush(): void {
        if (isUndefined(this._pendingSaveTimer)) {
            return
        }
        clearTimeout(this._pendingSaveTimer)
        this._pendingSaveTimer = undefined
        this._writeNow()
    }

    private _writeNow(): void {
        if (this._disabled) {
            return
        }

        // No-op rejection: skip the write when none of the arguments to
        // `_storage._set` have changed since the last successful write.
        // Callers spam `save()` after every property change, and many of
        // those changes leave the storage payload unchanged. Writing
        // identical bytes to localStorage still fires a cross-tab `storage`
        // event where Chrome allocates the payload buffer in mojo IPC even
        // though no listener reacts.
        //
        // The fingerprint covers all four meaningful inputs to `_storage._set`:
        // serialized props, expire_days, cross_subdomain, secure. For
        // localStorage / sessionStorage the last three are ignored by the
        // storage backend so including them just costs a redundant write
        // when cookie options change on a non-cookie store — rare and cheap.
        //
        // JSON.stringify can throw on BigInt / circular refs. We let the
        // underlying storage layer keep its existing try/catch behaviour
        // (log and drop) by falling through on serialization errors.
        try {
            const fingerprint =
                JSON.stringify(this.props) + '|' + this._expire_days + '|' + this._cross_subdomain + '|' + this._secure
            if (fingerprint === this._lastSavedSerialized) {
                return
            }
            this._lastSavedSerialized = fingerprint
        } catch {
            // fall through to storage._set, which handles the error itself
        }

        this._storage._set(
            this._name,
            this.props,
            this._expire_days,
            this._cross_subdomain,
            this._secure,
            this._config.debug
        )
    }

    remove(): void {
        // Cancel any pending debounced write — the storage entry is going
        // away so there is nothing useful to flush.
        if (!isUndefined(this._pendingSaveTimer)) {
            clearTimeout(this._pendingSaveTimer)
            this._pendingSaveTimer = undefined
        }
        // remove both domain and subdomain cookies
        this._storage._remove(this._name, false)
        this._storage._remove(this._name, true)
        // Storage entry is gone — any future save() must write through.
        this._lastSavedSerialized = undefined
    }

    // removes the storage entry and deletes all loaded data
    // forced name for tests

    clear(): void {
        this.remove()
        this.props = {}
    }

    /**
     * @param {Object} props
     * @param {*=} default_value
     * @param {number=} days
     */

    register_once(props: Properties, default_value: any, days?: number): boolean {
        if (isObject(props)) {
            if (isUndefined(default_value)) {
                default_value = 'None'
            }
            this._expire_days = isUndefined(days) ? this._default_expiry : days

            let hasChanges = false

            each(props, (val, prop) => {
                if (!this.props.hasOwnProperty(prop) || this.props[prop] === default_value) {
                    this._setProp(prop, val)
                    hasChanges = true
                }
            })

            if (hasChanges) {
                this.save()
                return true
            }
        }
        return false
    }

    /**
     * @param {Object} props
     * @param {number=} days
     */

    register(props: Properties, days?: number): boolean {
        if (isObject(props)) {
            this._expire_days = isUndefined(days) ? this._default_expiry : days

            let hasChanges = false

            each(props, (val, prop) => {
                if (props.hasOwnProperty(prop) && this.props[prop] !== val) {
                    this._setProp(prop, val)
                    hasChanges = true
                }
            })

            if (hasChanges) {
                this.save()
                return true
            }
        }
        return false
    }

    unregister(prop: string): void {
        if (prop in this.props) {
            this._deleteProp(prop)
            this.save()
        }
    }

    update_campaign_params(): void {
        if (!this._campaign_params_saved) {
            const campaignParams = getCampaignParams(
                this._config.custom_campaign_params,
                this._config.mask_personal_data_properties,
                this._config.custom_personal_data_properties
            )
            // only save campaign params if there were any
            if (!isEmptyObject(stripEmptyProperties(campaignParams))) {
                this.register(campaignParams)
            }
            this._campaign_params_saved = true
        }
    }
    update_search_keyword(): void {
        this.register(getSearchInfo())
    }

    update_referrer_info(): void {
        this.register_once(getReferrerInfo(), undefined)
    }

    set_initial_person_info(): void {
        if (this.props[INITIAL_CAMPAIGN_PARAMS] || this.props[INITIAL_REFERRER_INFO]) {
            // the user has initial properties stored the previous way, don't save them again
            return
        }

        this.register_once(
            {
                [INITIAL_PERSON_INFO]: getPersonInfo(
                    this._config.mask_personal_data_properties,
                    this._config.custom_personal_data_properties
                ),
            },
            undefined
        )
    }

    get_initial_props(): Properties {
        const p: Properties = {}

        // this section isn't written to anymore, but we should keep reading from it for backwards compatibility
        // for a while
        each([INITIAL_REFERRER_INFO, INITIAL_CAMPAIGN_PARAMS], (key) => {
            const initialReferrerInfo = this.props[key]
            if (initialReferrerInfo) {
                each(initialReferrerInfo, function (v, k) {
                    p['$initial_' + stripLeadingDollar(k)] = v
                })
            }
        })
        const initialPersonInfo = this.props[INITIAL_PERSON_INFO]
        if (initialPersonInfo) {
            const initialPersonProps = getInitialPersonPropsFromInfo(initialPersonInfo)
            extend(p, initialPersonProps)
        }

        return p
    }

    // safely fills the passed in object with stored properties,
    // does not override any properties defined in both
    // returns the passed in object

    safe_merge(props: Properties): Properties {
        each(this.props, function (val, prop) {
            if (!(prop in props)) {
                props[prop] = val
            }
        })

        return props
    }

    update_config(config: PostHogConfig, oldConfig: PostHogConfig, isDisabled?: boolean): void {
        this._default_expiry = this._expire_days = config['cookie_expiration']
        this.set_disabled(config['disable_persistence'] || !!isDisabled)
        this.set_cross_subdomain(config['cross_subdomain_cookie'])
        this.set_secure(config['secure_cookie'])

        // If the persistence type has changed, we need to migrate the data.
        if (
            config.persistence !== oldConfig.persistence ||
            !isArrayContentsEqual(config.cookie_persisted_properties || [], oldConfig.cookie_persisted_properties || [])
        ) {
            const newStore = this._buildStorage(config)
            const props = this.props

            // Clear the old store
            this.clear()

            // Set up the new store data
            this._storage = newStore
            this.props = props
            this.save()
        }
    }

    set_disabled(disabled: boolean): void {
        this._disabled = disabled
        if (this._disabled) {
            this.remove()
        } else {
            this.save()
        }
    }

    set_cross_subdomain(cross_subdomain: boolean): void {
        if (cross_subdomain !== this._cross_subdomain) {
            this._cross_subdomain = cross_subdomain
            this.remove()
            this.save()
        }
    }

    set_secure(secure: boolean): void {
        if (secure !== this._secure) {
            this._secure = secure
            this.remove()
            this.save()
        }
    }

    set_event_timer(event_name: string, timestamp: number): void {
        const timers = this.props[EVENT_TIMERS_KEY] || {}
        timers[event_name] = timestamp
        this._setProp(EVENT_TIMERS_KEY, timers)
        this.save()
    }

    remove_event_timer(event_name: string): number {
        const timers = this.props[EVENT_TIMERS_KEY] || {}
        const timestamp = timers[event_name]
        if (!isUndefined(timestamp)) {
            delete timers[event_name]
            this._setProp(EVENT_TIMERS_KEY, timers)
            this.save()
        }
        return timestamp
    }

    get_property(prop: string): any {
        return this.props[prop]
    }

    set_property(prop: string, to: any): void {
        this._setProp(prop, to)
        this.save()
    }

    private _setProp(prop: string, to: any): void {
        this.props[prop] = to
    }

    private _deleteProp(prop: string): void {
        delete this.props[prop]
    }
}

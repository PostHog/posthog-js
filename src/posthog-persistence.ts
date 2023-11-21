/* eslint camelcase: "off" */

import { _each, _extend, _include, _strip_empty_properties } from './utils'
import {
    COOKIE_PERSISTED_PROPERTIES,
    cookieStore,
    localPlusCookieStore,
    localStore,
    memoryStore,
    sessionStore,
} from './storage'
import { PersistentStore, PostHogConfig, Properties } from './types'
import {
    ENABLED_FEATURE_FLAGS,
    EVENT_TIMERS_KEY,
    PERSISTENCE_RESERVED_PROPERTIES,
    POSTHOG_QUOTA_LIMITED,
    USER_STATE,
} from './constants'

import { _isObject, _isUndefined } from './utils/type-utils'
import { _info } from './utils/event-utils'
import { logger } from './utils/logger'

const CASE_INSENSITIVE_PERSISTENCE_TYPES: readonly Lowercase<PostHogConfig['persistence']>[] = [
    'cookie',
    'localstorage',
    'localstorage+cookie',
    'sessionstorage',
    'memory',
    'default',
]

/**
 * PostHog Persistence Object
 * @constructor
 */
export class PostHogPersistence {
    props: Properties
    storage: PersistentStore
    campaign_params_saved: boolean
    custom_campaign_params: string[]
    name: string
    disabled: boolean | undefined
    secure: boolean | undefined
    expire_days: number | undefined
    default_expiry: number | undefined
    cross_subdomain: boolean | undefined
    user_state: 'anonymous' | 'identified'

    constructor(config: PostHogConfig) {
        // clean chars that aren't accepted by the http spec for cookie values
        // https://datatracker.ietf.org/doc/html/rfc2616#section-2.2
        let token = ''

        if (config['token']) {
            token = config['token'].replace(/\+/g, 'PL').replace(/\//g, 'SL').replace(/=/g, 'EQ')
        }

        this.props = {}
        this.campaign_params_saved = false
        this.custom_campaign_params = config['custom_campaign_params'] || []

        if (config['persistence_name']) {
            this.name = 'ph_' + config['persistence_name']
        } else {
            this.name = 'ph_' + token + '_posthog'
        }

        if (
            CASE_INSENSITIVE_PERSISTENCE_TYPES.indexOf(
                config['persistence'].toLowerCase() as Lowercase<PostHogConfig['persistence']>
            ) === -1
        ) {
            logger.critical('Unknown persistence type ' + config['persistence'] + '; falling back to default')
            config['persistence'] = 'default'
        }
        // We handle storage type in a case-insensitive way for backwards compatibility
        const storage_type = config['persistence'].toLowerCase() as Lowercase<PostHogConfig['persistence']>
        if (storage_type === 'localstorage' && localStore.is_supported()) {
            this.storage = localStore
        } else if (storage_type === 'localstorage+cookie' && localPlusCookieStore.is_supported()) {
            this.storage = localPlusCookieStore
        } else if (storage_type === 'sessionstorage' && sessionStore.is_supported()) {
            this.storage = sessionStore
        } else if (storage_type === 'memory') {
            this.storage = memoryStore
        } else if (storage_type === 'cookie') {
            this.storage = cookieStore
        } else {
            const { storage } = this._getAndMigrateToDefaultStore()
            this.storage = storage
        }

        this.user_state = 'anonymous'

        this.load()
        this.update_config(config)
        this.save()
    }

    properties(): Properties {
        const p: Properties = {}
        // Filter out reserved properties
        _each(this.props, function (v, k) {
            if (k === ENABLED_FEATURE_FLAGS && _isObject(v)) {
                const keys = Object.keys(v)
                for (let i = 0; i < keys.length; i++) {
                    p[`$feature/${keys[i]}`] = v[keys[i]]
                }
            } else if (!_include(PERSISTENCE_RESERVED_PROPERTIES, k)) {
                p[k] = v
            }
        })
        return p
    }

    load(): void {
        if (this.disabled) {
            return
        }

        const entry = this.storage.parse(this.name)

        if (entry) {
            this.props = _extend({}, entry)
        }
    }

    /**
     * NOTE: Saving frequently causes issues with Recordings and Consent Management Platform (CMP) tools which
     * observe cookie changes, and modify their UI, often causing infinite loops.
     * As such callers of this should ideally check that the data has changed beforehand
     */
    save(): void {
        if (this.disabled) {
            return
        }
        this.storage.set(this.name, this.props, this.expire_days, this.cross_subdomain, this.secure)
    }

    remove(): void {
        // remove both domain and subdomain cookies
        this.storage.remove(this.name, false)
        this.storage.remove(this.name, true)
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
        if (_isObject(props)) {
            if (_isUndefined(default_value)) {
                default_value = 'None'
            }
            this.expire_days = _isUndefined(days) ? this.default_expiry : days

            let hasChanges = false

            _each(props, (val, prop) => {
                if (!this.props.hasOwnProperty(prop) || this.props[prop] === default_value) {
                    this.props[prop] = val
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
        if (_isObject(props)) {
            this.expire_days = _isUndefined(days) ? this.default_expiry : days

            let hasChanges = false

            _each(props, (val, prop) => {
                if (props.hasOwnProperty(prop) && this.props[prop] !== val) {
                    this.props[prop] = val
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
            delete this.props[prop]
            this.save()
        }
    }

    update_campaign_params(): void {
        if (!this.campaign_params_saved) {
            this.register(_info.campaignParams(this.custom_campaign_params))
            this.campaign_params_saved = true
        }
    }

    update_search_keyword(): void {
        this.register(_info.searchInfo())
    }

    update_referrer_info(): void {
        this.register({
            $referrer: this.props['$referrer'] || _info.referrer(),
            $referring_domain: this.props['$referring_domain'] || _info.referringDomain(),
        })
    }

    get_referrer_info(): Properties {
        return _strip_empty_properties({
            $referrer: this['props']['$referrer'],
            $referring_domain: this['props']['$referring_domain'],
        })
    }

    // safely fills the passed in object with stored properties,
    // does not override any properties defined in both
    // returns the passed in object

    safe_merge(props: Properties): Properties {
        _each(this.props, function (val, prop) {
            if (!(prop in props)) {
                props[prop] = val
            }
        })

        return props
    }

    update_config(config: PostHogConfig): void {
        this.default_expiry = this.expire_days = config['cookie_expiration']
        this.set_disabled(config['disable_persistence'])
        this.set_cross_subdomain(config['cross_subdomain_cookie'])
        this.set_secure(config['secure_cookie'])
    }

    set_disabled(disabled: boolean): void {
        this.disabled = disabled
        if (this.disabled) {
            this.remove()
        } else {
            this.save()
        }
    }

    set_cross_subdomain(cross_subdomain: boolean): void {
        if (cross_subdomain !== this.cross_subdomain) {
            this.cross_subdomain = cross_subdomain
            this.remove()
            this.save()
        }
    }

    get_cross_subdomain(): boolean {
        return !!this.cross_subdomain
    }

    set_secure(secure: boolean): void {
        if (secure !== this.secure) {
            this.secure = secure
            this.remove()
            this.save()
        }
    }

    set_event_timer(event_name: string, timestamp: number): void {
        const timers = this.props[EVENT_TIMERS_KEY] || {}
        timers[event_name] = timestamp
        this.props[EVENT_TIMERS_KEY] = timers
        this.save()
    }

    remove_event_timer(event_name: string): number {
        const timers = this.props[EVENT_TIMERS_KEY] || {}
        const timestamp = timers[event_name]
        if (!_isUndefined(timestamp)) {
            delete this.props[EVENT_TIMERS_KEY][event_name]
            this.save()
        }
        return timestamp
    }

    get_user_state(): 'anonymous' | 'identified' {
        return this.props[USER_STATE] || 'anonymous'
    }

    set_user_state(state: 'anonymous' | 'identified'): void {
        this.props[USER_STATE] = state
        this.save()
    }

    get_quota_limits(): Record<string, number> {
        return this.props[POSTHOG_QUOTA_LIMITED] || {}
    }

    set_quota_limits(state: Record<string, number>): void {
        this.props[POSTHOG_QUOTA_LIMITED] = state
        this.save()
    }

    _getAndMigrateToDefaultStore = (): { storage: PersistentStore; wasPreviouslyDifferentStore: boolean } => {
        // Check if there's any data in local/cookie/session storage, and if needed,
        // migrate to cookie+localstorage
        const defaultStore = localPlusCookieStore
        const currentStore = this._getCurrentStore()

        if (currentStore && currentStore !== defaultStore) {
            this._migrateStoreToDefaultStore(currentStore, defaultStore)
            return { storage: defaultStore, wasPreviouslyDifferentStore: !!currentStore }
        } else {
            return { storage: defaultStore, wasPreviouslyDifferentStore: false }
        }
    }

    _getCurrentStore = () => {
        // Test by picking a property that is stored in the cookie for local+cookie
        const testKey = COOKIE_PERSISTED_PROPERTIES[0]

        // If that key exists in the local store, then we're definitely using
        // local storage
        const isLocalStore = localStore.is_supported() && localStore.get(this.name)?.[testKey]
        if (isLocalStore) {
            return localStore
        }
        // If not using pure localStore, we must be using localPlusCookie if
        // there's data in both
        const isLocalPlusCookie =
            localPlusCookieStore.is_supported() &&
            localStore.is_supported() &&
            localStore.get(this.name) &&
            cookieStore.is_supported() &&
            cookieStore.get(this.name)
        if (isLocalPlusCookie) {
            return localPlusCookieStore
        }
        // If there's any data in cookieStore at this point then we're on cookieStore
        const isCookie = cookieStore.is_supported() && cookieStore.get(this.name)
        if (isCookie) {
            return cookieStore
        }

        const isSession = sessionStore.is_supported() && sessionStore.get(this.name)
        if (isSession) {
            return sessionStore
        }

        // memory store, no existing store, or existing store no longer supported
        return undefined
    }

    _migrateStoreToDefaultStore(store: PersistentStore, defaultStore: PersistentStore) {
        const values = store.get(this.name)
        store.remove(this.name, this.cross_subdomain)
        defaultStore.set(this.name, values, this.expire_days, this.cross_subdomain, this.secure)
    }
}

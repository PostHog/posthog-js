/* eslint camelcase: "off" */

import { _each, _extend, _include, _info, _isObject, _isUndefined, _strip_empty_properties, logger } from './utils'
import { cookieStore, localStore, localPlusCookieStore, memoryStore, sessionStore } from './storage'
import { PersistentStore, PostHogConfig, Properties } from './types'

/*
 * Constants
 */
// This key is deprecated, but we want to check for it to see whether aliasing is allowed.
export const PEOPLE_DISTINCT_ID_KEY = '$people_distinct_id'
export const ALIAS_ID_KEY = '__alias'
export const CAMPAIGN_IDS_KEY = '__cmpns'
export const EVENT_TIMERS_KEY = '__timers'
export const AUTOCAPTURE_DISABLED_SERVER_SIDE = '$autocapture_disabled_server_side'
export const SESSION_RECORDING_ENABLED_SERVER_SIDE = '$session_recording_enabled_server_side'
export const CONSOLE_LOG_RECORDING_ENABLED_SERVER_SIDE = '$console_log_recording_enabled_server_side'
export const SESSION_RECORDING_RECORDER_VERSION_SERVER_SIDE = '$session_recording_recorder_version_server_side' // follows rrweb versioning
export const SESSION_ID = '$sesid'
export const ENABLED_FEATURE_FLAGS = '$enabled_feature_flags'
export const PERSISTENCE_EARLY_ACCESS_FEATURES = '$early_access_features'
export const STORED_PERSON_PROPERTIES_KEY = '$stored_person_properties'
export const STORED_GROUP_PROPERTIES_KEY = '$stored_group_properties'

const USER_STATE = '$user_state'

export const RESERVED_PROPERTIES = [
    PEOPLE_DISTINCT_ID_KEY,
    ALIAS_ID_KEY,
    CAMPAIGN_IDS_KEY,
    EVENT_TIMERS_KEY,
    SESSION_RECORDING_ENABLED_SERVER_SIDE,
    SESSION_ID,
    ENABLED_FEATURE_FLAGS,
    USER_STATE,
    PERSISTENCE_EARLY_ACCESS_FEATURES,
    STORED_GROUP_PROPERTIES_KEY,
    STORED_PERSON_PROPERTIES_KEY,
]

const CASE_INSENSITIVE_PERSISTENCE_TYPES: readonly Lowercase<PostHogConfig['persistence']>[] = [
    'cookie',
    'localstorage',
    'localstorage+cookie',
    'sessionstorage',
    'memory',
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
            logger.critical('Unknown persistence type ' + config['persistence'] + '; falling back to cookie')
            config['persistence'] = 'cookie'
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
        } else {
            this.storage = cookieStore
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
            if (k === ENABLED_FEATURE_FLAGS && typeof v === 'object') {
                const keys = Object.keys(v)
                for (let i = 0; i < keys.length; i++) {
                    p[`$feature/${keys[i]}`] = v[keys[i]]
                }
            } else if (!_include(RESERVED_PROPERTIES, k)) {
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
            if (typeof default_value === 'undefined') {
                default_value = 'None'
            }
            this.expire_days = typeof days === 'undefined' ? this.default_expiry : days

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
            this.expire_days = typeof days === 'undefined' ? this.default_expiry : days

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
}

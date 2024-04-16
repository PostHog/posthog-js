/* eslint camelcase: "off" */

import { _each, _extend, _include, _strip_empty_properties, _strip_leading_dollar } from './utils'
import { cookieStore, localPlusCookieStore, localStore, memoryStore, sessionStore } from './storage'
import { PersistentStore, PostHogConfig, Properties } from './types'
import {
    ENABLED_FEATURE_FLAGS,
    EVENT_TIMERS_KEY,
    INITIAL_CAMPAIGN_PARAMS,
    INITIAL_REFERRER_INFO,
    PERSISTENCE_RESERVED_PROPERTIES,
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

/**
 * PostHog Persistence Object
 * @constructor
 */
export class PostHogPersistence {
    private config: PostHogConfig
    props: Properties
    storage: PersistentStore
    campaign_params_saved: boolean
    name: string
    disabled: boolean | undefined
    secure: boolean | undefined
    expire_days: number | undefined
    default_expiry: number | undefined
    cross_subdomain: boolean | undefined

    constructor(config: PostHogConfig) {
        this.config = config
        this.props = {}
        this.campaign_params_saved = false
        this.name = parseName(config)
        this.storage = this.buildStorage(config)
        this.load()
        this.update_config(config, config)
        this.save()
    }

    private buildStorage(config: PostHogConfig) {
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

        let store: PersistentStore
        // We handle storage type in a case-insensitive way for backwards compatibility
        const storage_type = config['persistence'].toLowerCase() as Lowercase<PostHogConfig['persistence']>
        if (storage_type === 'localstorage' && localStore.is_supported()) {
            store = localStore
        } else if (storage_type === 'localstorage+cookie' && localPlusCookieStore.is_supported()) {
            store = localPlusCookieStore
        } else if (storage_type === 'sessionstorage' && sessionStore.is_supported()) {
            store = sessionStore
        } else if (storage_type === 'memory') {
            store = memoryStore
        } else if (storage_type === 'cookie') {
            store = cookieStore
        } else if (localPlusCookieStore.is_supported()) {
            // selected storage type wasn't supported, fallback to 'localstorage+cookie' if possible
            store = localPlusCookieStore
        } else {
            store = cookieStore
        }

        return store
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
            this.register(_info.campaignParams(this.config.custom_campaign_params))
            this.campaign_params_saved = true
        }
    }
    set_initial_campaign_params(): void {
        this.register_once(
            { [INITIAL_CAMPAIGN_PARAMS]: _info.campaignParams(this.config.custom_campaign_params) },
            undefined
        )
    }

    update_search_keyword(): void {
        this.register(_info.searchInfo())
    }

    update_referrer_info(): void {
        this.register(_info.referrerInfo())
    }

    set_initial_referrer_info(): void {
        this.register_once(
            {
                [INITIAL_REFERRER_INFO]: _info.referrerInfo(),
            },
            undefined
        )
    }

    get_referrer_info(): Properties {
        return _strip_empty_properties({
            $referrer: this['props']['$referrer'],
            $referring_domain: this['props']['$referring_domain'],
        })
    }

    get_initial_props(): Properties {
        const p: Properties = {}
        _each([INITIAL_REFERRER_INFO, INITIAL_CAMPAIGN_PARAMS], (key) => {
            const initialReferrerInfo = this.props[key]
            if (initialReferrerInfo) {
                _each(initialReferrerInfo, function (v, k) {
                    p['$initial_' + _strip_leading_dollar(k)] = v
                })
            }
        })
        return p
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

    update_config(config: PostHogConfig, oldConfig: PostHogConfig): void {
        this.default_expiry = this.expire_days = config['cookie_expiration']
        this.set_disabled(config['disable_persistence'])
        this.set_cross_subdomain(config['cross_subdomain_cookie'])
        this.set_secure(config['secure_cookie'])

        if (config.persistence !== oldConfig.persistence) {
            // If the persistence type has changed, we need to migrate the data.
            const newStore = this.buildStorage(config)
            const props = this.props

            // clear the old store
            this.clear()
            this.storage = newStore
            this.props = props

            this.save()
        }
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

    get_property(prop: string): any {
        return this.props[prop]
    }

    set_property(prop: string, to: any): void {
        this.props[prop] = to
        this.save()
    }
}

/* eslint camelcase: "off" */

import { each, extend, include, stripEmptyProperties } from './utils'
import { cookieStore, localPlusCookieStore, localStore, memoryStore, sessionStore } from './storage'
import { PersistentStore, PostHogConfig, Properties } from './types'
import {
    ENABLED_FEATURE_FLAGS,
    EVENT_TIMERS_KEY,
    INITIAL_CAMPAIGN_PARAMS,
    INITIAL_PERSON_INFO,
    INITIAL_REFERRER_INFO,
    PERSISTENCE_RESERVED_PROPERTIES,
} from './constants'

import { isUndefined } from '@posthog/core'
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

    properties(): Properties {
        const p: Properties = {}
        // Filter out reserved properties
        each(this.props, function (v, k) {
            if (k === ENABLED_FEATURE_FLAGS && isObject(v)) {
                const keys = Object.keys(v)
                for (let i = 0; i < keys.length; i++) {
                    p[`$feature/${keys[i]}`] = v[keys[i]]
                }
            } else if (!include(PERSISTENCE_RESERVED_PROPERTIES, k)) {
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
        // remove both domain and subdomain cookies
        this._storage._remove(this._name, false)
        this._storage._remove(this._name, true)
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
        if (isObject(props)) {
            this._expire_days = isUndefined(days) ? this._default_expiry : days

            let hasChanges = false

            each(props, (val, prop) => {
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

        if (config.persistence !== oldConfig.persistence) {
            // If the persistence type has changed, we need to migrate the data.
            const newStore = this._buildStorage(config)
            const props = this.props

            // clear the old store
            this.clear()
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
        this.props[EVENT_TIMERS_KEY] = timers
        this.save()
    }

    remove_event_timer(event_name: string): number {
        const timers = this.props[EVENT_TIMERS_KEY] || {}
        const timestamp = timers[event_name]
        if (!isUndefined(timestamp)) {
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

/* eslint camelcase: "off" */

import Config from './config'
import { _, console } from './utils'

/*
 * Constants
 */
/** @const */ var SET_QUEUE_KEY = '__mps'
/** @const */ var SET_ONCE_QUEUE_KEY = '__mpso'
/** @const */ var UNSET_QUEUE_KEY = '__mpus'
/** @const */ var ADD_QUEUE_KEY = '__mpa'
/** @const */ var APPEND_QUEUE_KEY = '__mpap'
/** @const */ var REMOVE_QUEUE_KEY = '__mpr'
/** @const */ var UNION_QUEUE_KEY = '__mpu'
// This key is deprecated, but we want to check for it to see whether aliasing is allowed.
/** @const */ var PEOPLE_DISTINCT_ID_KEY = '$people_distinct_id'
/** @const */ var ALIAS_ID_KEY = '__alias'
/** @const */ var CAMPAIGN_IDS_KEY = '__cmpns'
/** @const */ var EVENT_TIMERS_KEY = '__timers'
/** @const */ var SESSION_RECORDING_ENABLED = '$session_recording_enabled'
/** @const */ var SESSION_ID = '$sesid'
/** @const */ var RESERVED_PROPERTIES = [
    SET_QUEUE_KEY,
    SET_ONCE_QUEUE_KEY,
    UNSET_QUEUE_KEY,
    ADD_QUEUE_KEY,
    APPEND_QUEUE_KEY,
    REMOVE_QUEUE_KEY,
    UNION_QUEUE_KEY,
    PEOPLE_DISTINCT_ID_KEY,
    ALIAS_ID_KEY,
    CAMPAIGN_IDS_KEY,
    EVENT_TIMERS_KEY,
    SESSION_RECORDING_ENABLED,
    SESSION_ID,
]

/**
 * PostHog Persistence Object
 * @constructor
 */
var PostHogPersistence = function (config) {
    this['props'] = {}
    this.campaign_params_saved = false
    this['featureFlagEventHandlers'] = []

    if (config['persistence_name']) {
        this.name = 'ph_' + config['persistence_name']
    } else {
        this.name = 'ph_' + config['token'] + '_posthog'
    }

    var storage_type = config['persistence']
    if (storage_type !== 'cookie' && storage_type !== 'localStorage') {
        console.critical('Unknown persistence type ' + storage_type + '; falling back to cookie')
        storage_type = config['persistence'] = 'cookie'
    }

    if (storage_type === 'localStorage' && _.localStorage.is_supported()) {
        this.storage = _.localStorage
    } else {
        this.storage = _.cookie
    }

    this.load()
    this.update_config(config)
    this.upgrade(config)
    this.save()
}

PostHogPersistence.prototype.addFeatureFlagsHandler = function (handler) {
    this.featureFlagEventHandlers.push(handler)
    return true
}

PostHogPersistence.prototype.receivedFeatureFlags = function (flags) {
    this.featureFlagEventHandlers.forEach((handler) => handler(flags))
}

PostHogPersistence.prototype.properties = function () {
    var p = {}
    // Filter out reserved properties
    _.each(this['props'], function (v, k) {
        if (!_.include(RESERVED_PROPERTIES, k)) {
            p[k] = v
        }
    })
    return p
}

PostHogPersistence.prototype.load = function () {
    if (this.disabled) {
        return
    }

    var entry = this.storage.parse(this.name)

    if (entry) {
        this['props'] = _.extend({}, entry)
    }
}

PostHogPersistence.prototype.upgrade = function (config) {
    var upgrade_from_old_lib = config['upgrade'],
        old_cookie_name,
        old_cookie

    if (upgrade_from_old_lib) {
        old_cookie_name = 'ph_super_properties'
        // Case where they had a custom cookie name before.
        if (typeof upgrade_from_old_lib === 'string') {
            old_cookie_name = upgrade_from_old_lib
        }

        old_cookie = this.storage.parse(old_cookie_name)

        // remove the cookie
        this.storage.remove(old_cookie_name)
        this.storage.remove(old_cookie_name, true)

        if (old_cookie) {
            this['props'] = _.extend(this['props'], old_cookie['all'], old_cookie['events'])
        }
    }

    if (!config['cookie_name'] && config['name'] !== 'posthog') {
        // special case to handle people with cookies of the form
        // ph_TOKEN_INSTANCENAME from the first release of this library
        old_cookie_name = 'ph_' + config['token'] + '_' + config['name']
        old_cookie = this.storage.parse(old_cookie_name)

        if (old_cookie) {
            this.storage.remove(old_cookie_name)
            this.storage.remove(old_cookie_name, true)

            // Save the prop values that were in the cookie from before -
            // this should only happen once as we delete the old one.
            this.register_once(old_cookie)
        }
    }

    if (this.storage === _.localStorage) {
        old_cookie = _.cookie.parse(this.name)

        _.cookie.remove(this.name)
        _.cookie.remove(this.name, true)

        if (old_cookie) {
            this.register_once(old_cookie)
        }
    }
}

PostHogPersistence.prototype.save = function () {
    if (this.disabled) {
        return
    }
    this._expire_notification_campaigns()
    this.storage.set(this.name, _.JSONEncode(this['props']), this.expire_days, this.cross_subdomain, this.secure)
}

PostHogPersistence.prototype.remove = function () {
    // remove both domain and subdomain cookies
    this.storage.remove(this.name, false)
    this.storage.remove(this.name, true)
}

// removes the storage entry and deletes all loaded data
// forced name for tests
PostHogPersistence.prototype.clear = function () {
    this.remove()
    this['props'] = {}
}

/**
 * @param {Object} props
 * @param {*=} default_value
 * @param {number=} days
 */
PostHogPersistence.prototype.register_once = function (props, default_value, days) {
    if (_.isObject(props)) {
        if (typeof default_value === 'undefined') {
            default_value = 'None'
        }
        this.expire_days = typeof days === 'undefined' ? this.default_expiry : days
        if (props && props.$active_feature_flags) {
            this.receivedFeatureFlags(props.$active_feature_flags)
        }

        _.each(
            props,
            function (val, prop) {
                if (!this['props'].hasOwnProperty(prop) || this['props'][prop] === default_value) {
                    this['props'][prop] = val
                }
            },
            this
        )

        this.save()

        return true
    }
    return false
}

/**
 * @param {Object} props
 * @param {number=} days
 */
PostHogPersistence.prototype.register = function (props, days) {
    if (_.isObject(props)) {
        this.expire_days = typeof days === 'undefined' ? this.default_expiry : days
        if (props && props.$active_feature_flags) {
            this.receivedFeatureFlags(props.$active_feature_flags)
        }

        _.extend(this['props'], props)

        this.save()

        return true
    }
    return false
}

PostHogPersistence.prototype.unregister = function (prop) {
    if (prop in this['props']) {
        delete this['props'][prop]
        this.save()

        if (prop === '$active_feature_flags') {
            this.receivedFeatureFlags([])
        }
    }
}

PostHogPersistence.prototype._expire_notification_campaigns = _.safewrap(function () {
    var campaigns_shown = this['props'][CAMPAIGN_IDS_KEY],
        EXPIRY_TIME = Config.DEBUG ? 60 * 1000 : 60 * 60 * 1000 // 1 minute (Config.DEBUG) / 1 hour (PDXN)
    if (!campaigns_shown) {
        return
    }
    for (var campaign_id in campaigns_shown) {
        if (1 * new Date() - campaigns_shown[campaign_id] > EXPIRY_TIME) {
            delete campaigns_shown[campaign_id]
        }
    }
    if (_.isEmptyObject(campaigns_shown)) {
        delete this['props'][CAMPAIGN_IDS_KEY]
    }
})

PostHogPersistence.prototype.update_campaign_params = function () {
    if (!this.campaign_params_saved) {
        this.register_once(_.info.campaignParams())
        this.campaign_params_saved = true
    }
}

PostHogPersistence.prototype.update_search_keyword = function (referrer) {
    this.register(_.info.searchInfo(referrer))
}

// EXPORTED METHOD, we test this directly.
PostHogPersistence.prototype.update_referrer_info = function (referrer) {
    // If referrer doesn't exist, we want to note the fact that it was type-in traffic.
    this.register_once(
        {
            $initial_referrer: referrer || '$direct',
            $initial_referring_domain: _.info.referringDomain(referrer) || '$direct',
        },
        ''
    )
}

PostHogPersistence.prototype.get_referrer_info = function () {
    return _.strip_empty_properties({
        $initial_referrer: this['props']['$initial_referrer'],
        $initial_referring_domain: this['props']['$initial_referring_domain'],
    })
}

// safely fills the passed in object with stored properties,
// does not override any properties defined in both
// returns the passed in object
PostHogPersistence.prototype.safe_merge = function (props) {
    _.each(this['props'], function (val, prop) {
        if (!(prop in props)) {
            props[prop] = val
        }
    })

    return props
}

PostHogPersistence.prototype.update_config = function (config) {
    this.default_expiry = this.expire_days = config['cookie_expiration']
    this.set_disabled(config['disable_persistence'])
    this.set_cross_subdomain(config['cross_subdomain_cookie'])
    this.set_secure(config['secure_cookie'])
}

PostHogPersistence.prototype.set_disabled = function (disabled) {
    this.disabled = disabled
    if (this.disabled) {
        this.remove()
    } else {
        this.save()
    }
}

PostHogPersistence.prototype.set_cross_subdomain = function (cross_subdomain) {
    if (cross_subdomain !== this.cross_subdomain) {
        this.cross_subdomain = cross_subdomain
        this.remove()
        this.save()
    }
}

PostHogPersistence.prototype.get_cross_subdomain = function () {
    return this.cross_subdomain
}

PostHogPersistence.prototype.set_secure = function (secure) {
    if (secure !== this.secure) {
        this.secure = secure ? true : false
        this.remove()
        this.save()
    }
}

PostHogPersistence.prototype.set_event_timer = function (event_name, timestamp) {
    var timers = this['props'][EVENT_TIMERS_KEY] || {}
    timers[event_name] = timestamp
    this['props'][EVENT_TIMERS_KEY] = timers
    this.save()
}

PostHogPersistence.prototype.remove_event_timer = function (event_name) {
    var timers = this['props'][EVENT_TIMERS_KEY] || {}
    var timestamp = timers[event_name]
    if (!_.isUndefined(timestamp)) {
        delete this['props'][EVENT_TIMERS_KEY][event_name]
        this.save()
    }
    return timestamp
}

export {
    PostHogPersistence,
    SET_QUEUE_KEY,
    SET_ONCE_QUEUE_KEY,
    PEOPLE_DISTINCT_ID_KEY,
    ALIAS_ID_KEY,
    CAMPAIGN_IDS_KEY,
    EVENT_TIMERS_KEY,
    SESSION_RECORDING_ENABLED,
    SESSION_ID,
}

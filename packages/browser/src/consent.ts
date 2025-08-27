import { PostHog } from './posthog-core'
import { find } from './utils'
import { assignableWindow, navigator } from './utils/globals'
import { cookieStore, localStore } from './storage'
import { PersistentStore } from './types'
import { isNoLike, isYesLike } from '@posthog/core'

const OPT_OUT_PREFIX = '__ph_opt_in_out_'

export enum ConsentStatus {
    PENDING = -1,
    DENIED = 0,
    GRANTED = 1,
}

/**
 * ConsentManager provides tools for managing user consent as configured by the application.
 */
export class ConsentManager {
    private _persistentStore?: PersistentStore

    constructor(private _instance: PostHog) {}

    private get _config() {
        return this._instance.config
    }

    public get consent(): ConsentStatus {
        if (this._getDnt()) {
            return ConsentStatus.DENIED
        }

        return this._storedConsent
    }

    public isOptedOut() {
        if (this._config.cookieless_mode === 'always') {
            return true
        }
        // we are opted out if:
        // * consent is explicitly denied
        // * consent is pending, and we are configured to opt out by default
        // * consent is pending, and we are in cookieless mode "on_reject"
        return (
            this.consent === ConsentStatus.DENIED ||
            (this.consent === ConsentStatus.PENDING &&
                (this._config.opt_out_capturing_by_default || this._config.cookieless_mode === 'on_reject'))
        )
    }

    public isOptedIn() {
        return !this.isOptedOut()
    }

    public isExplicitlyOptedOut() {
        return this.consent === ConsentStatus.DENIED
    }

    public optInOut(isOptedIn: boolean) {
        this._storage._set(
            this._storageKey,
            isOptedIn ? 1 : 0,
            this._config.cookie_expiration,
            this._config.cross_subdomain_cookie,
            this._config.secure_cookie
        )
    }

    public reset() {
        this._storage._remove(this._storageKey, this._config.cross_subdomain_cookie)
    }

    private get _storageKey() {
        const { token, opt_out_capturing_cookie_prefix, consent_persistence_name } = this._instance.config
        if (consent_persistence_name) {
            return consent_persistence_name
        } else if (opt_out_capturing_cookie_prefix) {
            // Deprecated, but we still support it for backwards compatibility.
            // This was deprecated because it differed in behaviour from storage.ts, and appends the token.
            // This meant it was not possible to share the same consent state across multiple PostHog instances,
            // and made it harder for people to migrate from other systems.
            return opt_out_capturing_cookie_prefix + token
        } else {
            return OPT_OUT_PREFIX + token
        }
    }

    private get _storedConsent(): ConsentStatus {
        const value = this._storage._get(this._storageKey)
        // be somewhat permissive in what we accept as yes/opt-in, to make it easier for people to migrate from other systems
        return isYesLike(value) ? ConsentStatus.GRANTED : isNoLike(value) ? ConsentStatus.DENIED : ConsentStatus.PENDING
    }

    private get _storage() {
        if (!this._persistentStore) {
            const persistenceType = this._config.opt_out_capturing_persistence_type
            this._persistentStore = persistenceType === 'localStorage' ? localStore : cookieStore
            const otherStorage = persistenceType === 'localStorage' ? cookieStore : localStore

            if (otherStorage._get(this._storageKey)) {
                if (!this._persistentStore._get(this._storageKey)) {
                    // This indicates we have moved to a new storage format so we migrate the value over
                    this.optInOut(isYesLike(otherStorage._get(this._storageKey)))
                }

                otherStorage._remove(this._storageKey, this._config.cross_subdomain_cookie)
            }
        }

        return this._persistentStore
    }

    private _getDnt(): boolean {
        if (!this._config.respect_dnt) {
            return false
        }
        return !!find(
            [
                navigator?.doNotTrack, // standard
                (navigator as any)?.['msDoNotTrack'],
                assignableWindow['doNotTrack'],
            ],
            (dntValue): boolean => {
                return isYesLike(dntValue)
            }
        )
    }
}

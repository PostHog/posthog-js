import { PostHog } from './posthog-core'
import { find } from './utils'
import { assignableWindow, navigator } from './utils/globals'
import { cookieStore, localStore } from './storage'
import { PersistentStore } from './types'
import { includes } from './utils/string-utils'

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
        return (
            this.consent === ConsentStatus.DENIED ||
            (this.consent === ConsentStatus.PENDING && this._config.opt_out_capturing_by_default)
        )
    }

    public isOptedIn() {
        return !this.isOptedOut()
    }

    public optInOut(isOptedIn: boolean) {
        this._storage.set(
            this._storageKey,
            isOptedIn ? 1 : 0,
            this._config.cookie_expiration,
            this._config.cross_subdomain_cookie,
            this._config.secure_cookie
        )
    }

    public reset() {
        this._storage.remove(this._storageKey, this._config.cross_subdomain_cookie)
    }

    private get _storageKey() {
        const { token, opt_out_capturing_cookie_prefix } = this._instance.config
        return (opt_out_capturing_cookie_prefix || OPT_OUT_PREFIX) + token
    }

    private get _storedConsent(): ConsentStatus {
        const value = this._storage.get(this._storageKey)
        return value === '1' ? ConsentStatus.GRANTED : value === '0' ? ConsentStatus.DENIED : ConsentStatus.PENDING
    }

    private get _storage() {
        if (!this._persistentStore) {
            const persistenceType = this._config.opt_out_capturing_persistence_type
            this._persistentStore = persistenceType === 'localStorage' ? localStore : cookieStore
            const otherStorage = persistenceType === 'localStorage' ? cookieStore : localStore

            if (otherStorage.get(this._storageKey)) {
                if (!this._persistentStore.get(this._storageKey)) {
                    // This indicates we have moved to a new storage format so we migrate the value over
                    this.optInOut(otherStorage.get(this._storageKey) === '1')
                }

                otherStorage.remove(this._storageKey, this._config.cross_subdomain_cookie)
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
                return includes([true, 1, '1', 'yes'], dntValue)
            }
        )
    }
}

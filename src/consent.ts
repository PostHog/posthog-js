import { PostHog } from './posthog-core'
import { find, includes } from './utils'
import { assignableWindow, navigator } from './utils/globals'
import { cookieStore, localStore } from './storage'
import { PersistentStore } from './types'

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
    private _storage?: PersistentStore

    constructor(private instance: PostHog) {}

    private get config() {
        return this.instance.config
    }

    public get consent(): ConsentStatus {
        if (this.getDnt()) {
            return ConsentStatus.DENIED
        }

        return this.storedConsent
    }

    public isOptedOut() {
        return (
            this.consent === ConsentStatus.DENIED ||
            (this.consent === ConsentStatus.PENDING && this.config.opt_out_capturing_by_default)
        )
    }

    public isOptedIn() {
        return !this.isOptedOut()
    }

    public optInOut(isOptedIn: boolean) {
        this.storage.set(
            this.storageKey,
            isOptedIn ? 1 : 0,
            this.config.cookie_expiration,
            this.config.cross_subdomain_cookie,
            this.config.secure_cookie
        )
    }

    public reset() {
        this.storage.remove(this.storageKey, this.config.cross_subdomain_cookie)
    }

    private get storageKey() {
        const { token, opt_out_capturing_cookie_prefix } = this.instance.config
        return (opt_out_capturing_cookie_prefix || OPT_OUT_PREFIX) + token
    }

    private get storedConsent(): ConsentStatus {
        const value = this.storage.get(this.storageKey)
        return value === '1' ? ConsentStatus.GRANTED : value === '0' ? ConsentStatus.DENIED : ConsentStatus.PENDING
    }

    private get storage() {
        if (!this._storage) {
            const persistenceType = this.config.opt_out_capturing_persistence_type
            this._storage = persistenceType === 'localStorage' ? localStore : cookieStore
            const otherStorage = persistenceType === 'localStorage' ? cookieStore : localStore

            if (otherStorage.get(this.storageKey)) {
                if (!this._storage.get(this.storageKey)) {
                    // This indicates we have moved to a new storage format so we migrate the value over
                    this.optInOut(otherStorage.get(this.storageKey) === '1')
                }

                otherStorage.remove(this.storageKey, this.config.cross_subdomain_cookie)
            }
        }

        return this._storage
    }

    private getDnt(): boolean {
        if (!this.config.respect_dnt) {
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

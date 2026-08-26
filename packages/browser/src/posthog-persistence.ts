/* eslint camelcase: "off" */

import { each, extend, stripEmptyProperties, addEventListener } from '@posthog/browser-common/utils/general-utils'
import {
    COOKIE_IDENTITY_BOUND_LOCAL_PROPERTIES,
    COOKIE_PERSISTED_PROPERTIES,
    cookieStore,
    createLocalPlusCookieStore,
    getCookiePersistedProperties,
    getCookiePersistedPropertiesMetadata,
    getCookiePersistedPropertiesMetadataState,
    getCookiePropertiesFingerprint,
    getSafeCookieProperties,
    localStore,
    memoryStore,
    sessionStore,
} from './storage'
import { PersistentStore, PostHogConfig, Properties } from './types'
import { document, window } from '@posthog/browser-common/utils/globals'
import {
    ALIAS_ID_KEY,
    DISTINCT_ID,
    ENABLED_FEATURE_FLAGS,
    EVENT_TIMERS_KEY,
    FLAG_CALL_REPORTED,
    INITIAL_CAMPAIGN_PARAMS,
    INITIAL_PERSON_INFO,
    INITIAL_REFERRER_INFO,
    PERSISTENCE_ACTIVE_FEATURE_FLAGS,
    PERSISTENCE_FEATURE_FLAG_DETAILS,
    PERSISTENCE_FEATURE_FLAG_ERRORS,
    PERSISTENCE_FEATURE_FLAG_EVALUATED_AT,
    PERSISTENCE_FEATURE_FLAG_PAYLOADS,
    PERSISTENCE_FEATURE_FLAG_REQUEST_ID,
    STORED_GROUP_PROPERTIES_KEY,
    STORED_PERSON_PROPERTIES_KEY,
    SURVEYS_LOADED_AT,
    USER_STATE,
    USER_STATE_ANONYMOUS,
    USER_STATE_IDENTIFIED,
} from './constants'
import { getPersistenceKeyPolicy, PERSISTENCE_STORAGE_GROUPS, PersistenceStorageGroup } from './persistence-key-policy'

// The "freshness" key each split group stamps when its server payload is
// (re)loaded. A group entry carrying an older timestamp than the main blob is a
// stale orphan (a gate-off / older-SDK tab wrote a fresher payload back to main)
// and must not win on load. Groups without an entry here have no freshness
// signal, so the group entry wins by default (the migrated-forward home).
const VOLATILE_FINGERPRINT_PLACEHOLDER = '__volatile__'

// Both freshness keys are volatile (their on-disk value lags the last content
// change). That is safe: when only the stamp moved, both the group entry and the
// main blob hold identical content, so whichever side wins still produces the
// same values. A mixed-fleet race at most causes one extra /flags cycle.
const GROUP_FRESHNESS_KEY: Partial<Record<PersistenceStorageGroup, string>> = {
    flags: PERSISTENCE_FEATURE_FLAG_EVALUATED_AT,
    surveys: SURVEYS_LOADED_AT,
}

import { isArray, isNull, isNumber, isUndefined } from '@posthog/core'
import {
    getCampaignParams,
    getInitialPersonPropsFromInfo,
    getPersonInfo,
    getReferrerInfo,
    getSearchInfo,
} from '@posthog/browser-common/utils/event-utils'
import { logger } from '@posthog/browser-common/utils/logger'
import { stripLeadingDollar, isEmptyObject, isObject } from '@posthog/core'

const CASE_INSENSITIVE_PERSISTENCE_TYPES: readonly Lowercase<PostHogConfig['persistence']>[] = [
    'cookie',
    'localstorage',
    'localstorage+cookie',
    'sessionstorage',
    'memory',
]

const getCookieIdentityChangePendingName = (name: string): string => `${name}_cookie_identity_change_pending`

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

// Fingerprint slot for the main persistence entry. Group entries (`flags`)
// use their group name as the slot. See `_writeEntry`.
const MAIN_STORAGE_SLOT = 'main'

// Feature flag evaluation state is shared by every same-origin tab. Keep these
// keys synchronized so a stale tab cannot overwrite an enrollment or cached
// flag update when it next writes the persistence blob.
const CROSS_TAB_FEATURE_FLAG_KEYS = [
    ENABLED_FEATURE_FLAGS,
    PERSISTENCE_ACTIVE_FEATURE_FLAGS,
    STORED_PERSON_PROPERTIES_KEY,
] as const

const isCrossTabFeatureFlagKey = (key: string): boolean =>
    (CROSS_TAB_FEATURE_FLAG_KEYS as readonly string[]).indexOf(key) !== -1

const isStorageValueEqual = (left: unknown, right: unknown): boolean => {
    try {
        return JSON.stringify(left) === JSON.stringify(right)
    } catch {
        return left === right
    }
}

const parseStorageValue = (value: string | null): Properties => {
    if (!value) {
        return {}
    }
    const parsed = JSON.parse(value)
    return isObject(parsed) ? parsed : {}
}

type StorageSlot = PersistenceStorageGroup | typeof MAIN_STORAGE_SLOT

// Per-entry write bookkeeping (see `PostHogPersistence._slotState`).
interface SlotWriteState {
    // Serialized snapshot of the last confirmed-successful write to this entry;
    // a save that reproduces it is skipped (no-op rejection — writing identical
    // bytes still fires a cross-tab `storage` broadcast). Undefined until the
    // first successful write.
    fingerprint?: string
    // A prop in this group changed since its last successful write, so the large
    // flag/survey payload is re-serialized on the next save. Group slots only —
    // the main slot always serializes (small, and carries cookie options).
    dirty?: boolean
    // This group entry has materialized on disk this session (loaded at startup
    // or written since), so `_writeNowSplit` writes it through even when empty to
    // clear a stale on-disk entry. Recorded only after a confirmed write.
    persisted?: boolean
}

const isArrayContentsEqual = (arr1: readonly string[], arr2: readonly string[]): boolean => {
    if (arr1.length !== arr2.length) {
        return false
    }

    const sortedArr1 = [...arr1].sort()
    const sortedArr2 = [...arr2].sort()
    return sortedArr1.every((item, index) => item === sortedArr2[index])
}

const clearStaleEventProperties = (props: Properties, cookieProperties: Properties): void => {
    each(props, (_value, key) => {
        const policy = getPersistenceKeyPolicy(key)
        if ((!policy || policy.exposure === 'event') && !Object.prototype.hasOwnProperty.call(cookieProperties, key)) {
            delete props[key]
        }
    })
}

/**
 * PostHog Persistence Object
 * @constructor
 */
export class PostHogPersistence {
    private _config: PostHogConfig
    props: Properties
    private _storage: PersistentStore
    private _campaign_params_url: string | undefined
    private readonly _name: string
    _disabled: boolean | undefined
    private _secure: boolean | undefined
    private _expire_days: number | undefined
    private _default_expiry: number | undefined
    private _cross_subdomain: boolean | undefined
    // Per-storage-entry write bookkeeping, keyed by slot (`main` plus each group
    // name): no-op-rejection fingerprint, per-group dirty flag, and on-disk
    // materialization. Reset wholesale on remove()/clear() so a save after
    // remove always lands. See `SlotWriteState`.
    private _slotState: Partial<Record<StorageSlot, SlotWriteState>> = {}
    // Whether the resolved storage backend can host the split (localStorage /
    // localStorage+cookie). Set by `_buildStorage`.
    private _splitStorageEligible = false
    // Whether flag config is stored in their own entries this session:
    // backend-eligible AND `split_storage` enabled.
    // Re-resolved on every `update_config` (backend rebuild or a runtime flag flip).
    private _splitStorage = false
    // Whether this instance owns (and may clean up) the shared split group
    // entries. The localStorage primary owns them; the sessionStorage sibling
    // posthog-core spins up shares the primary's storage name, so it must not
    // remove them — otherwise its remove() (fired via set_secure on every
    // set_config reconstruction) would wipe the primary's __flags entry.
    private readonly _ownsSplitStorage: boolean
    // Optional debounce: when `persistence_save_debounce_ms` is > 0, rapid
    // calls to `save()` are coalesced into one write at the end of the
    // window. The in-memory `props` is always updated synchronously, so
    // in-tab reads see the latest values regardless. Pending writes are
    // flushed on `beforeunload` and `pagehide` so no state is lost on
    // tab close.
    private _pendingSaveTimer: ReturnType<typeof setTimeout> | undefined
    // Snapshot of the last shared-cookie state this instance observed or wrote.
    // Cookies do not emit cross-origin storage events, so captures and writes use
    // this fingerprint to cheaply detect identity changes made on sibling subdomains.
    private _lastSeenCookiePropertiesFingerprint: string | undefined
    private _lastSeenMainCookieValue: string | undefined
    // Identity changes can be adopted by background persistence writes before
    // capture runs. Keep the transition pending until core performs the flag and
    // person-cache side effects associated with the new identity.
    private _cookieIdentityChangePending = false
    // A local reset or storage migration owns the next cookie snapshot. Ignore
    // sibling writes until the complete replacement has been published.
    private _cookieSyncSuppressed = false
    // Nested feature-flag entries changed locally and waiting for a durable
    // write. Sibling updates to other flags can still be merged while pending.
    private _pendingCrossTabFeatureFlagChanges = new Map<string, Set<string> | true>()
    private _storageMigrationInProgress = false
    private _crossTabFeatureFlagHandler?: () => void
    private _onStorage?: (event: StorageEvent) => void

    /**
     * @param {PostHogConfig} config initial PostHog configuration
     * @param {boolean=} isDisabled should persistence be disabled (e.g. because of consent management)
     */
    constructor(config: PostHogConfig, isDisabled?: boolean, ownsSplitStorage: boolean = true) {
        this._config = config
        this._ownsSplitStorage = ownsSplitStorage
        this.props = {}
        this._campaign_params_url = undefined
        this._name = parseName(config)
        this._storage = this._buildStorage(config)
        this._splitStorage = this._resolveSplitStorage(config)
        this.load()
        // Preserve only values for which load() selected a fresher source than
        // the current storage entry. Ordinary loaded values remain mergeable.
        this._markLoadedCrossTabFeatureFlagChangesPending()
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
            this._onStorage = (event: StorageEvent): void => {
                if (
                    !this._splitStorageEligible ||
                    (event.storageArea && event.storageArea !== window?.localStorage) ||
                    !event.key
                ) {
                    return
                }
                if (event.key === this._name) {
                    this._syncCrossTabFeatureFlagProperties(event.key, MAIN_STORAGE_SLOT)
                    return
                }
                if (this._splitStorage) {
                    const group = PERSISTENCE_STORAGE_GROUPS.find((group) => event.key === this._groupEntryName(group))
                    if (group) {
                        this._syncCrossTabFeatureFlagProperties(event.key, group)
                    }
                }
            }
            addEventListener(window, 'storage', this._onStorage as EventListener)
        }
    }

    onCrossTabFeatureFlagChange(handler: () => void): () => void {
        this._crossTabFeatureFlagHandler = handler
        return () => {
            if (this._crossTabFeatureFlagHandler === handler) {
                this._crossTabFeatureFlagHandler = undefined
            }
        }
    }

    destroy(): void {
        if (this._onStorage && window) {
            window.removeEventListener('storage', this._onStorage as EventListener)
            this._onStorage = undefined
        }
        this._crossTabFeatureFlagHandler = undefined
    }

    private _syncCrossTabFeatureFlagProperties(storageKey: string, slot: StorageSlot, notify: boolean = true): boolean {
        if (this._disabled) {
            return false
        }

        let nextEntry: Properties
        try {
            // A queued storage event can be older than the value currently on disk.
            // Always reconcile against the latest snapshot instead of event.newValue.
            nextEntry = parseStorageValue(localStore._get(storageKey))
        } catch {
            return false
        }

        return this._mergeCrossTabFeatureFlagProperties(nextEntry, slot, notify)
    }

    private _mergeCrossTabFeatureFlagProperties(nextEntry: Properties, slot: StorageSlot, notify: boolean): boolean {
        let changed = false
        CROSS_TAB_FEATURE_FLAG_KEYS.forEach((key) => {
            const group = getPersistenceKeyPolicy(key)?.storageGroup
            if (
                (slot === MAIN_STORAGE_SLOT && this._splitStorage && group) ||
                (slot !== MAIN_STORAGE_SLOT && group !== slot)
            ) {
                return
            }

            const hasNextValue = key in nextEntry
            const nextValue = this._mergePendingCrossTabFeatureFlagChanges(
                key,
                hasNextValue ? nextEntry[key] : undefined
            )
            const keepKey = this._pendingCrossTabFeatureFlagChanges.has(key) ? key in this.props : hasNextValue
            if (keepKey === key in this.props && isStorageValueEqual(nextValue, this.props[key])) {
                return
            }
            if (keepKey) {
                this.props[key] = nextValue
            } else {
                delete this.props[key]
            }
            changed = true
        })
        if (changed && notify) {
            this._crossTabFeatureFlagHandler?.()
        }
        return changed
    }

    private _reconcileCrossTabFeatureFlagPropertiesBeforeWrite(): boolean {
        if (!this._splitStorageEligible) {
            return false
        }

        try {
            const mainEntry = parseStorageValue(localStore._get(this._name))
            let changed = this._mergeCrossTabFeatureFlagProperties(mainEntry, MAIN_STORAGE_SLOT, false)
            if (this._splitStorage) {
                PERSISTENCE_STORAGE_GROUPS.forEach((group) => {
                    const groupValue = localStore._get(this._groupEntryName(group))
                    // Before the first split write, grouped keys can still live in
                    // the main blob. Use it as the migration fallback.
                    const groupEntry = isNull(groupValue) ? mainEntry : parseStorageValue(groupValue)
                    changed = this._mergeCrossTabFeatureFlagProperties(groupEntry, group, false) || changed
                })
            }
            return changed
        } catch {
            return false
        }
    }

    private _markAllCrossTabFeatureFlagChangesPending(): void {
        CROSS_TAB_FEATURE_FLAG_KEYS.forEach((key) => this._pendingCrossTabFeatureFlagChanges.set(key, true))
    }

    private _markLoadedCrossTabFeatureFlagChangesPending(): void {
        if (!this._splitStorageEligible) {
            return
        }
        try {
            const mainEntry = parseStorageValue(localStore._get(this._name))
            CROSS_TAB_FEATURE_FLAG_KEYS.forEach((key) => {
                const group = this._splitStorage ? getPersistenceKeyPolicy(key)?.storageGroup : undefined
                const storedEntry = group ? parseStorageValue(localStore._get(this._groupEntryName(group))) : mainEntry
                if (key in this.props) {
                    this._markPendingCrossTabFeatureFlagChanges(key, storedEntry[key], this.props[key])
                } else if (key in storedEntry) {
                    this._pendingCrossTabFeatureFlagChanges.set(key, true)
                }
            })
        } catch {}
    }

    private _mergePendingCrossTabFeatureFlagChanges(key: string, nextValue: unknown): unknown {
        const pendingChanges = this._pendingCrossTabFeatureFlagChanges.get(key)
        if (!pendingChanges) {
            return nextValue
        }
        if (pendingChanges === true) {
            return this.props[key]
        }

        if (key === PERSISTENCE_ACTIVE_FEATURE_FLAGS) {
            const merged = new Set<string>(isArray(nextValue) ? nextValue : [])
            const local = new Set<string>(isArray(this.props[key]) ? this.props[key] : [])
            pendingChanges.forEach((flag) => (local.has(flag) ? merged.add(flag) : merged.delete(flag)))
            return Array.from(merged)
        }

        const merged: Properties = isObject(nextValue) ? { ...nextValue } : {}
        const local: Properties = isObject(this.props[key]) ? this.props[key] : {}
        pendingChanges.forEach((property) => {
            if (property in local) {
                merged[property] = local[property]
            } else {
                delete merged[property]
            }
        })
        return merged
    }

    private _markPendingCrossTabFeatureFlagChanges(key: string, previousValue: unknown, nextValue: unknown): void {
        if (!isCrossTabFeatureFlagKey(key)) {
            return
        }
        if (this._pendingCrossTabFeatureFlagChanges.get(key) === true) {
            return
        }

        // Recompute against the latest durable value instead of accumulating
        // mutations. A local false -> true -> false sequence is no longer pending
        // when storage still contains false, so a later sibling update can win.
        let durableValue = previousValue
        if (this._splitStorageEligible) {
            try {
                const group = this._splitStorage ? getPersistenceKeyPolicy(key)?.storageGroup : undefined
                const storageKey = group ? this._groupEntryName(group) : this._name
                durableValue = parseStorageValue(localStore._get(storageKey))[key]
            } catch {}
        }

        const existingPendingChanges = this._pendingCrossTabFeatureFlagChanges.get(key)
        const pendingChanges = new Set<string>(existingPendingChanges || [])
        if (key === PERSISTENCE_ACTIVE_FEATURE_FLAGS) {
            if (
                (!isUndefined(previousValue) && !isArray(previousValue)) ||
                (!isUndefined(durableValue) && !isArray(durableValue)) ||
                !isArray(nextValue)
            ) {
                this._pendingCrossTabFeatureFlagChanges.set(key, true)
                return
            }
            const previous = new Set<string>(previousValue || [])
            const durable = new Set<string>(durableValue || [])
            const next = new Set<string>(nextValue)
            new Set([...previous, ...next]).forEach((flag) => {
                if (previous.has(flag) !== next.has(flag)) {
                    pendingChanges.add(flag)
                }
            })
            pendingChanges.forEach((flag) => {
                if (durable.has(flag) === next.has(flag)) {
                    pendingChanges.delete(flag)
                }
            })
        } else if (isObject(nextValue)) {
            if (!isUndefined(previousValue) && !isObject(previousValue)) {
                this._pendingCrossTabFeatureFlagChanges.set(key, true)
                return
            }
            const previous: Properties = isObject(previousValue) ? previousValue : {}
            const durable: Properties = isObject(durableValue) ? durableValue : {}
            new Set([...Object.keys(previous), ...Object.keys(nextValue)]).forEach((property) => {
                if (
                    property in previous !== property in nextValue ||
                    !isStorageValueEqual(previous[property], nextValue[property])
                ) {
                    pendingChanges.add(property)
                }
            })
            pendingChanges.forEach((property) => {
                if (
                    property in durable === property in nextValue &&
                    isStorageValueEqual(durable[property], nextValue[property])
                ) {
                    pendingChanges.delete(property)
                }
            })
        } else {
            this._pendingCrossTabFeatureFlagChanges.set(key, true)
            return
        }

        if (pendingChanges.size) {
            this._pendingCrossTabFeatureFlagChanges.set(key, pendingChanges)
        } else {
            this._pendingCrossTabFeatureFlagChanges.delete(key)
        }
    }

    private _saveDebounceMs(): number {
        const value = this._config?.persistence_save_debounce_ms
        return isNumber(value) && value > 0 ? value : 0
    }

    private _rememberCurrentCookieProperties(props?: Properties): void {
        if (!this._config.cookieWinsOnConflict || this._config.persistence.toLowerCase() !== 'localstorage+cookie') {
            return
        }
        if (props) {
            // Remember exactly what this write attempted instead of rereading the
            // shared cookie. A sibling can update the cookie immediately after our
            // write; recording that later value here would hide an unseen update.
            try {
                const cookieProperties = getCookiePersistedProperties(
                    props,
                    this._config.cookie_persisted_properties || []
                )
                const customCookieProperties = this._config.cookie_persisted_properties || []
                const metadata = getCookiePersistedPropertiesMetadata(cookieProperties, customCookieProperties)
                const expectedFingerprint = JSON.stringify(cookieProperties) + '|' + JSON.stringify(metadata)
                // `localStorage+cookie._set` reports localStorage success even if
                // its best-effort cookie mirror fails. Advance the observed
                // fingerprint only when the shared cookie actually contains this
                // exact snapshot. A different value may be either the old cookie
                // or a sibling write, and must remain eligible for reconciliation.
                const currentCookieValue = cookieStore._get(this._name) || undefined
                if (
                    currentCookieValue &&
                    getCookiePropertiesFingerprint(this._name, currentCookieValue) === expectedFingerprint
                ) {
                    this._lastSeenCookiePropertiesFingerprint = expectedFingerprint
                    this._lastSeenMainCookieValue = currentCookieValue
                }
            } catch {}
            return
        }
        try {
            const cookieValue = cookieStore._get(this._name) || undefined
            this._lastSeenCookiePropertiesFingerprint = cookieValue
                ? getCookiePropertiesFingerprint(this._name, cookieValue)
                : undefined
            this._lastSeenMainCookieValue = cookieValue
        } catch {}
    }

    /**
     * Adopt shared-cookie changes made by a sibling subdomain without replacing
     * localStorage-only or pending in-memory properties. Returns true when a new
     * non-empty cookie snapshot was observed.
     */
    syncCookieProperties(): boolean {
        return this._syncCookieProperties(this._config)
    }

    private _syncCookieProperties(config: PostHogConfig, ignoreDisabled: boolean = false): boolean {
        if (
            (this._disabled && !ignoreDisabled) ||
            this._cookieSyncSuppressed ||
            !config.cookieWinsOnConflict ||
            config.persistence.toLowerCase() !== 'localstorage+cookie'
        ) {
            return false
        }

        let cookieValue: string | undefined
        try {
            cookieValue = cookieStore._get(this._name) || undefined
        } catch {}
        if (!cookieValue || cookieValue === this._lastSeenMainCookieValue) {
            // Ignore sidecar-only changes. Metadata is meaningful only together
            // with a new main snapshot, and treating it as a sibling identity
            // update could roll back a local write when the main mirror failed.
            return false
        }
        const cookieFingerprint = getCookiePropertiesFingerprint(this._name, cookieValue)

        let cookieProperties: Properties
        try {
            cookieProperties = getSafeCookieProperties(JSON.parse(cookieValue))
        } catch {
            return false
        }
        // If the main cookie changed while its metadata was read, retry on the
        // next synchronization rather than applying the old values while marking
        // the new snapshot as observed.
        if ((cookieStore._get(this._name) || undefined) !== cookieValue) {
            return false
        }
        this._lastSeenCookiePropertiesFingerprint = cookieFingerprint
        this._lastSeenMainCookieValue = cookieValue
        const metadataState = getCookiePersistedPropertiesMetadataState(this._name, cookieValue)
        const authoritativeCookieProperties = [...COOKIE_PERSISTED_PROPERTIES, ...metadataState.properties]
        const invalidCookieProperties: Record<string, true> = {}
        Object.keys(cookieProperties).forEach((key) => {
            const value = cookieProperties[key]
            if (
                isUndefined(value) ||
                isNull(value) ||
                value === '' ||
                (key === USER_STATE && value !== USER_STATE_ANONYMOUS && value !== USER_STATE_IDENTIFIED)
            ) {
                invalidCookieProperties[key] = true
                delete cookieProperties[key]
            }
        })
        if (isEmptyObject(cookieProperties)) {
            return false
        }
        const hasValidCookieIdentity =
            DISTINCT_ID in cookieProperties ||
            cookieProperties[USER_STATE] === USER_STATE_ANONYMOUS ||
            cookieProperties[USER_STATE] === USER_STATE_IDENTIFIED

        const previousProps = this.props
        const previousDistinctId = previousProps[DISTINCT_ID]
        const previousUserState = previousProps[USER_STATE]
        const nextProps = extend({}, previousProps)
        const cookiePersistedProperties = [
            ...COOKIE_PERSISTED_PROPERTIES,
            ...(config.cookie_persisted_properties || []),
        ]
        cookiePersistedProperties.forEach((key) => {
            if (
                authoritativeCookieProperties.indexOf(key) !== -1 &&
                !(key in cookieProperties) &&
                !invalidCookieProperties[key] &&
                (hasValidCookieIdentity || (key !== DISTINCT_ID && key !== USER_STATE))
            ) {
                const localValue = nextProps[key]
                const legacyFalsyBuiltIn =
                    !metadataState.isValid &&
                    COOKIE_PERSISTED_PROPERTIES.indexOf(key) !== -1 &&
                    (localValue === false || localValue === 0)
                if (!legacyFalsyBuiltIn) {
                    delete nextProps[key]
                }
            }
        })
        this.props = extend(nextProps, cookieProperties)
        CROSS_TAB_FEATURE_FLAG_KEYS.forEach((key) => {
            const hadPreviousValue = key in previousProps
            const hasNextValue = key in this.props
            if (hadPreviousValue !== hasNextValue || !isStorageValueEqual(previousProps[key], this.props[key])) {
                if (hasNextValue) {
                    this._markPendingCrossTabFeatureFlagChanges(key, previousProps[key], this.props[key])
                } else {
                    this._pendingCrossTabFeatureFlagChanges.set(key, true)
                }
            }
        })
        // Older writers can omit $user_state entirely. Once that authoritative
        // omission removes a prior identified state, represent it explicitly as
        // anonymous so reset cleanup (including $groups) runs consistently.
        if (hasValidCookieIdentity && !(USER_STATE in cookieProperties) && !(USER_STATE in this.props)) {
            this._setProp(USER_STATE, USER_STATE_ANONYMOUS)
        }
        const nextDistinctId = this.props[DISTINCT_ID]
        const nextUserState = this.props[USER_STATE]
        if (hasValidCookieIdentity && (nextDistinctId !== previousDistinctId || nextUserState !== previousUserState)) {
            this._cookieIdentityChangePending = true
            sessionStore._set(getCookieIdentityChangePendingName(this._name), true)
            this._deleteProp(STORED_PERSON_PROPERTIES_KEY)
            this._deleteProp(PERSISTENCE_ACTIVE_FEATURE_FLAGS)
            this._deleteProp(ENABLED_FEATURE_FLAGS)
            this._deleteProp(PERSISTENCE_FEATURE_FLAG_DETAILS)
            this._deleteProp(PERSISTENCE_FEATURE_FLAG_PAYLOADS)
            this._deleteProp(PERSISTENCE_FEATURE_FLAG_REQUEST_ID)
            this._deleteProp(PERSISTENCE_FEATURE_FLAG_EVALUATED_AT)
            this._deleteProp(PERSISTENCE_FEATURE_FLAG_ERRORS)
            this._deleteProp(FLAG_CALL_REPORTED)
            const siblingReset =
                nextUserState === USER_STATE_ANONYMOUS &&
                (previousUserState === USER_STATE_IDENTIFIED ||
                    cookieProperties[USER_STATE] === USER_STATE_ANONYMOUS ||
                    (!isUndefined(previousDistinctId) && nextDistinctId !== previousDistinctId))
            if (siblingReset) {
                // reset() clears event-visible persistence. Mirror that for a
                // sibling reset without discarding hidden SDK state or values
                // that the new shared-cookie snapshot explicitly carries.
                clearStaleEventProperties(this.props, cookieProperties)
                this._deleteProp(STORED_GROUP_PROPERTIES_KEY)
            }
            // `$user_id` is localStorage-only, but it is bound to the current
            // identity. Never carry the previous logged-in user across a sibling
            // identify/reset adopted from the shared cookie.
            if (nextUserState === USER_STATE_IDENTIFIED) {
                this.props.$user_id = nextDistinctId
            } else {
                delete this.props.$user_id
            }
            this._deleteProp(ALIAS_ID_KEY)
        }
        return true
    }

    consumeCookieIdentityChange(): boolean {
        const pendingName = getCookieIdentityChangePendingName(this._name)
        const changed = this._cookieIdentityChangePending || !!sessionStore._get(pendingName)
        this._cookieIdentityChangePending = false
        if (changed) {
            sessionStore._remove(pendingName)
        }
        return changed
    }

    _beginCookieSyncSuppression(ignoreDisabled: boolean = false): boolean {
        if (
            !this._cookieSyncSuppressed &&
            (!this._disabled || ignoreDisabled) &&
            this._config.cookieWinsOnConflict &&
            this._config.persistence.toLowerCase() === 'localstorage+cookie'
        ) {
            this._cookieSyncSuppressed = true
            return true
        }
        return false
    }

    _publishSuppressedCookieSnapshot(): void {
        if (!this._cookieSyncSuppressed) {
            return
        }
        if (!isUndefined(this._pendingSaveTimer)) {
            clearTimeout(this._pendingSaveTimer)
            this._pendingSaveTimer = undefined
        }
        // Force the complete local snapshot through without reconciling a
        // stale sibling write observed during this authoritative transaction.
        delete this._slotState[MAIN_STORAGE_SLOT]
        this._writeNow(true)
    }

    _endCookieSyncSuppression(publish: boolean = true): void {
        if (!this._cookieSyncSuppressed) {
            return
        }
        try {
            if (publish) {
                this._publishSuppressedCookieSnapshot()
            } else if (!isUndefined(this._pendingSaveTimer)) {
                // A failed identify/reset may have scheduled saves before it
                // threw. Do not let one run after suppression is released and
                // publish the incomplete transaction asynchronously.
                clearTimeout(this._pendingSaveTimer)
                this._pendingSaveTimer = undefined
            }
        } finally {
            this._cookieSyncSuppressed = false
        }
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
        const localPlusCookieStore = createLocalPlusCookieStore(
            config['cookie_persisted_properties'] || [],
            config.cookieWinsOnConflict
        )

        let store: PersistentStore

        // The flag split is only meaningful on a localStorage-backed
        // store: it is the one that broadcasts large cross-tab `storage` events.
        // cookie can't hold the cluster, memory/sessionStorage don't broadcast.
        let splitEligible = false

        // We handle storage type in a case-insensitive way for backwards compatibility
        const storage_type = config['persistence'].toLowerCase() as Lowercase<PostHogConfig['persistence']>
        if (storage_type === 'localstorage' && localStore._is_supported()) {
            store = localStore
            splitEligible = true
        } else if (storage_type === 'localstorage+cookie' && localPlusCookieStore._is_supported()) {
            store = localPlusCookieStore
            splitEligible = true
        } else if (storage_type === 'sessionstorage' && sessionStore._is_supported()) {
            store = sessionStore
        } else if (storage_type === 'memory') {
            store = memoryStore
        } else if (storage_type === 'cookie') {
            store = cookieStore
        } else if (localPlusCookieStore._is_supported()) {
            // selected storage type wasn't supported, fallback to 'localstorage+cookie' if possible
            store = localPlusCookieStore
            splitEligible = true
        } else {
            store = cookieStore
        }

        this._splitStorageEligible = splitEligible
        return store
    }

    private _groupEntryName(group: PersistenceStorageGroup): string {
        return `${this._name}__${group}`
    }

    // The split is on only when the resolved backend can host it (localStorage /
    // localStorage+cookie, set by `_buildStorage` into `_splitStorageEligible`)
    // AND the config opts in. Resolved here so the constructor and the runtime
    // `update_config` toggle can never disagree about whether the split is active.
    private _resolveSplitStorage(config: PostHogConfig): boolean {
        return this._splitStorageEligible && !!config['split_storage']
    }

    properties(): Properties {
        const p: Properties = {}

        each(this.props, (v, k) => {
            const policy = getPersistenceKeyPolicy(k)

            if (!policy || policy.exposure === 'event') {
                if (policy?.shouldSkipFromEventProperties?.(v)) {
                    return
                }

                // Unknown keys are treated as user-defined super properties and remain event-visible.
                p[k] = v
            }
        })
        return p
    }

    /**
     * Reload persisted properties from storage.
     *
     * @param allowDisabled - Read while this instance is disabled when shared consent changed in another tab
     * and the in-memory disabled state has not yet been reconciled.
     */
    load(allowDisabled: boolean = false): void {
        if (this._disabled && !allowDisabled) {
            return
        }

        const reconcileCookieIdentity =
            this._config.cookieWinsOnConflict && this._config.persistence.toLowerCase() === 'localstorage+cookie'
        const localEntryBeforeMerge = reconcileCookieIdentity ? localStore._parse(this._name) : null
        let cookieEntryBeforeMerge: Properties = {}
        if (reconcileCookieIdentity) {
            try {
                cookieEntryBeforeMerge = getSafeCookieProperties(cookieStore._parse(this._name))
                each(cookieEntryBeforeMerge, (value, key) => {
                    if (isUndefined(value) || isNull(value) || value === '') {
                        delete cookieEntryBeforeMerge[key]
                    }
                })
            } catch {}
        }
        const entry = this._storage._parse(this._name)

        if (entry) {
            this.props = extend({}, entry)
        }

        if (this._splitStorage) {
            this._loadGroupEntries()
        }

        if (reconcileCookieIdentity && entry) {
            const previousDistinctId = localEntryBeforeMerge?.[DISTINCT_ID]
            const previousUserState = localEntryBeforeMerge?.[USER_STATE] ?? USER_STATE_ANONYMOUS
            const nextDistinctId = entry[DISTINCT_ID]
            const nextUserState = entry[USER_STATE] ?? USER_STATE_ANONYMOUS
            if (nextDistinctId !== previousDistinctId || nextUserState !== previousUserState) {
                this._cookieIdentityChangePending = true
                sessionStore._set(getCookieIdentityChangePendingName(this._name), true)
                const nextProps = extend({}, this.props)
                COOKIE_IDENTITY_BOUND_LOCAL_PROPERTIES.forEach((key) => delete nextProps[key])
                const siblingReset =
                    nextUserState === USER_STATE_ANONYMOUS &&
                    (previousUserState === USER_STATE_IDENTIFIED ||
                        cookieEntryBeforeMerge[USER_STATE] === USER_STATE_ANONYMOUS ||
                        (!isUndefined(previousDistinctId) && nextDistinctId !== previousDistinctId))
                if (siblingReset) {
                    clearStaleEventProperties(nextProps, cookieEntryBeforeMerge)
                    delete nextProps[STORED_GROUP_PROPERTIES_KEY]
                }
                this.props = nextProps

                // Split entries are loaded after the main blob, so remove the
                // previous identity's grouped flag state from both memory and its
                // localStorage slot before a future load can restore it again.
                const affectedGroups = new Set<PersistenceStorageGroup>()
                COOKIE_IDENTITY_BOUND_LOCAL_PROPERTIES.forEach((key) => {
                    const group = getPersistenceKeyPolicy(key)?.storageGroup
                    if (group) {
                        affectedGroups.add(group)
                    }
                })
                affectedGroups.forEach((group) => {
                    const groupProps: Properties = {}
                    each(this.props, (value, key) => {
                        if (getPersistenceKeyPolicy(key)?.storageGroup === group) {
                            groupProps[key] = value
                        }
                    })
                    if (isEmptyObject(groupProps)) {
                        localStore._remove(this._groupEntryName(group))
                        this._slotState[group] = {}
                    } else if (localStore._set(this._groupEntryName(group), groupProps)) {
                        this._slotState[group] = {
                            persisted: true,
                            fingerprint: this._entryFingerprint(groupProps, group),
                        }
                    }
                })
            }
        }

        // A write can durably adopt the new main-cookie identity before core has
        // cleared the separate session persistence. Keep that cleanup pending
        // across reloads in this browser tab.
        if (sessionStore._get(getCookieIdentityChangePendingName(this._name))) {
            this._cookieIdentityChangePending = true
        }

        // `_parse()` may have read a different cookie than a reread here if a
        // sibling writes concurrently. Let the first synchronization compare the
        // current shared cookie with the loaded props instead of marking an
        // arbitrary later snapshot as observed.
    }

    // Merge each group entry over `props`, which already holds the main blob.
    // On a first upgrade the main blob may still carry the old flag
    // values; a present group entry wins, so we resolve
    // `props[key] = group[key] ?? main[key]` in a single pass (the "check the
    // old key once" migration). The first `save()` then strips the keys from
    // the main blob. Group entries are localStorage-only (read via `localStore`
    // directly, never the cookie or the localPlusCookie re-write-on-parse path).
    private _loadGroupEntries(): void {
        for (const group of PERSISTENCE_STORAGE_GROUPS) {
            // `localStore._parse` returns `{}` (not null) for a missing key, so
            // gate on real content: an empty/absent entry is not "persisted" and
            // must not be tracked, or `_writeNowSplit` would re-create it as `{}`.
            const groupEntry = localStore._parse(this._groupEntryName(group))
            if (groupEntry && !isEmptyObject(groupEntry)) {
                const state = this._slotWriteState(group)
                state.persisted = true
                // Seed the no-op fingerprint with the snapshot we just read, so the
                // first frequent main-blob save at startup (before fresh flags
                // return from the network) recognises an unchanged flag entry and
                // neither re-serializes nor re-broadcasts it to every open tab.
                // Only safe when the main blob carries no key for this group: a
                // leftover (partial migration, or a stale tab that wrote a flag key
                // back to main) makes the partitioned payload differ from what is on
                // disk, so the entry must still be written. Leaving it unseeded then
                // lets the first save's fingerprint check write the merged payload
                // through — completing the migration / healing the orphan. The
                // `_writeEntry` group fast-path skips on `!dirty && fingerprint set`,
                // which would otherwise short-circuit that write before the
                // fingerprint is even compared.
                if (!this._mainCarriesGroupKey(group)) {
                    state.fingerprint = this._entryFingerprint(groupEntry, group)
                }
                // The group entry is normally the migrated-forward home and wins
                // over the main blob. The exception: a group that stamps a
                // freshness timestamp (flags: $feature_flag_evaluated_at) lets us
                // detect when a gate-off / older-SDK tab wrote a fresher payload
                // back into the main blob — then we keep the main blob and let the
                // next save heal the group entry. With no timestamp on either side
                // (migration leftover) the group wins.
                if (!this._groupEntryIsStale(group, groupEntry)) {
                    extend(this.props, groupEntry)
                }
            }
        }
    }

    // True when the already-loaded main blob still holds a key belonging to this
    // group — a migration leftover the next save must fold into the group entry.
    // Checked before the group entry is merged in, so it sees only the main blob's
    // own keys (sibling groups carry a different storageGroup and never match).
    private _mainCarriesGroupKey(group: PersistenceStorageGroup): boolean {
        return Object.keys(this.props).some((key) => getPersistenceKeyPolicy(key)?.storageGroup === group)
    }

    private _groupEntryIsStale(group: PersistenceStorageGroup, groupEntry: Properties): boolean {
        const freshnessKey = GROUP_FRESHNESS_KEY[group]
        if (!freshnessKey) {
            return false
        }
        const groupLoadedAt = groupEntry[freshnessKey]
        const mainLoadedAt = this.props[freshnessKey]
        return isNumber(groupLoadedAt) && isNumber(mainLoadedAt) && mainLoadedAt > groupLoadedAt
    }

    /**
     * Refresh a single key from on-disk storage into `this.props` without
     * touching the rest. Used by `SessionIdManager` on the cross-tab idle
     * path so we can pick up a sibling tab's SESSION_ID write without
     * either:
     *  - flushing our own (potentially stale) whole-props blob to storage
     *    via `flush()`, which would clobber the sibling's write, or
     *  - replacing all of `props` via `load()`, which would discard any
     *    in-memory writes that haven't yet been debounced to storage.
     */
    refreshKey(prop: string): void {
        if (this._disabled) {
            return
        }
        const group = this._splitStorage ? getPersistenceKeyPolicy(prop)?.storageGroup : undefined
        const entry = group ? localStore._parse(this._groupEntryName(group)) : this._storage._parse(this._name)
        if (entry && prop in entry) {
            this._setProp(prop, entry[prop])
            return
        }
        // A grouped key that has not migrated yet still lives in the main blob;
        // check there once before concluding a sibling removed it.
        if (group) {
            const mainEntry = this._storage._parse(this._name)
            if (mainEntry && prop in mainEntry) {
                this._setProp(prop, mainEntry[prop])
                return
            }
        }
        this._deleteProp(prop)
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

    private _writeNow(forceSuppressedSnapshot = false): void {
        if (this._disabled || (this._cookieSyncSuppressed && !forceSuppressedSnapshot)) {
            return
        }

        // Reconcile immediately before writing as well as before capture. This
        // closes the debounce window where a sibling identify/reset could
        // otherwise be overwritten by this tab's pending stale whole-blob save.
        // A transaction ending suppression owns its complete snapshot and must
        // not adopt a sibling write that arrived while it was in progress.
        if (!forceSuppressedSnapshot) {
            this.syncCookieProperties()
        }

        const crossTabPropertiesChanged =
            !forceSuppressedSnapshot && !this._storageMigrationInProgress
                ? this._reconcileCrossTabFeatureFlagPropertiesBeforeWrite()
                : false
        if (this._splitStorage) {
            this._writeNowSplit()
            if (crossTabPropertiesChanged) {
                this._crossTabFeatureFlagHandler?.()
            }
            return
        }

        const writeResult = this._writeEntry(this._storage, this._name, this.props, MAIN_STORAGE_SLOT)
        if (writeResult) {
            this._rememberCurrentCookieProperties(this.props)
        }
        if (writeResult !== false) {
            this._pendingCrossTabFeatureFlagChanges.clear()
        }
        if (crossTabPropertiesChanged) {
            this._crossTabFeatureFlagHandler?.()
        }
    }

    // Partition `props` by storage group and write each entry independently:
    // the main blob without the grouped keys (stripping them completes the
    // migration), plus one entry per group holding only its keys. Per-entry
    // fingerprints mean a main-blob change does not rewrite the rarely-changing
    // flag entries, and vice-versa — which is the whole bandwidth win.
    // Group entries go to `localStore` directly so they never hit the 4 KB
    // cookie or the localPlusCookie re-write-on-parse path. INVARIANT: keep group
    // entries on `localStore` — `_entryFingerprint` omits the cookie options from
    // group fingerprints precisely because cookies can never carry a group entry;
    // routing one to a cookie store would make a cookie-option change silently
    // skip a needed rewrite.
    private _writeNowSplit(): void {
        const { main, groups } = this._partitionProps()
        const mainWriteResult = this._writeEntry(this._storage, this._name, main, MAIN_STORAGE_SLOT)
        if (mainWriteResult) {
            this._rememberCurrentCookieProperties(main)
        }
        if (mainWriteResult !== false) {
            CROSS_TAB_FEATURE_FLAG_KEYS.forEach((key) => {
                if (!getPersistenceKeyPolicy(key)?.storageGroup) {
                    this._pendingCrossTabFeatureFlagChanges.delete(key)
                }
            })
        }
        for (const group of PERSISTENCE_STORAGE_GROUPS) {
            const groupProps = groups[group]
            // Don't materialize an entry just to hold `{}`: skip a group that is
            // empty and has never been persisted. Once a group has held content
            // we keep writing it (even when empty) so a later clear actually lands.
            if (isEmptyObject(groupProps) && !this._slotState[group]?.persisted) {
                CROSS_TAB_FEATURE_FLAG_KEYS.forEach((key) => {
                    if (getPersistenceKeyPolicy(key)?.storageGroup === group) {
                        this._pendingCrossTabFeatureFlagChanges.delete(key)
                    }
                })
                continue
            }
            // `_writeEntry` marks the slot `persisted` (on `_slotState`) only
            // after a confirmed-successful `_set`, so a failed (e.g. quota) write
            // does not falsely mark the group as materialized on disk.
            const groupWriteResult = this._writeEntry(localStore, this._groupEntryName(group), groupProps, group)
            if (groupWriteResult !== false) {
                CROSS_TAB_FEATURE_FLAG_KEYS.forEach((key) => {
                    if (getPersistenceKeyPolicy(key)?.storageGroup === group) {
                        this._pendingCrossTabFeatureFlagChanges.delete(key)
                    }
                })
            }
        }
    }

    private _partitionProps(): { main: Properties; groups: Record<PersistenceStorageGroup, Properties> } {
        const main: Properties = {}
        const groups: Record<PersistenceStorageGroup, Properties> = { flags: {}, surveys: {} }
        each(this.props, (value, key) => {
            const group = getPersistenceKeyPolicy(key)?.storageGroup
            if (group) {
                groups[group][key] = value
            } else {
                main[key] = value
            }
        })
        return { main, groups }
    }

    // The no-op-rejection snapshot for an entry. The main entry can live in a
    // cookie, so its fingerprint also covers the cookie options (expire_days,
    // cross_subdomain, secure): a `set_config({ cookie_expiration })` must force
    // a rewrite even when props are unchanged, otherwise the cookie keeps its old
    // `Expires` header until some other prop changes. Group entries are
    // localStorage-only — cookie options never reach them, so excluding those
    // keeps a group fingerprint a pure function of its payload. That lets `load()`
    // seed it before the cookie options are even resolved, and keeps it stable
    // across the cookie-option setters that run during construction, so an
    // unchanged flag entry is neither re-serialized nor re-broadcast.
    private _entryFingerprint(props: Properties, slot: StorageSlot): string {
        if (slot === MAIN_STORAGE_SLOT) {
            return JSON.stringify(props) + '|' + this._expire_days + '|' + this._cross_subdomain + '|' + this._secure
        }
        // Volatile keys count by presence only: a write triggered by a real
        // content change records a fingerprint that stays valid while the
        // volatile values keep moving between writes, but adding or deleting a
        // volatile key still changes the fingerprint so the entry writes through.
        const stable: Properties = {}
        each(props, (value, key) => {
            stable[key] = getPersistenceKeyPolicy(key)?.volatile ? VOLATILE_FINGERPRINT_PLACEHOLDER : value
        })
        return JSON.stringify(stable)
    }

    // No-op rejection: skip the write when nothing that affects this entry has
    // changed since the last successful write. Callers spam `save()` after every
    // property change, and many of those changes leave the storage payload
    // unchanged. Writing identical bytes to localStorage still fires a cross-tab
    // `storage` event where Chrome allocates the payload buffer in mojo IPC even
    // though no listener reacts.
    //
    // JSON.stringify can throw on BigInt / circular refs. We let the
    // underlying storage layer keep its existing try/catch behaviour
    // (log and drop) by falling through on serialization errors.
    private _writeEntry(
        storage: PersistentStore,
        name: string,
        props: Properties,
        slot: StorageSlot
    ): boolean | undefined {
        const state = this._slotWriteState(slot)
        // Fast path for group slots (localStorage-only): when nothing in the
        // group changed since its last successful write, skip the JSON.stringify
        // of the large flag payload entirely. The main slot is excluded —
        // it is small, changes on nearly every write, and carries cookie options
        // in its fingerprint, so it always serializes.
        if (slot !== MAIN_STORAGE_SLOT && !state.dirty && !isUndefined(state.fingerprint)) {
            return undefined
        }

        let fingerprint: string | undefined
        try {
            fingerprint = this._entryFingerprint(props, slot)
            if (fingerprint === state.fingerprint) {
                state.dirty = false
                return undefined
            }
        } catch {
            // serialization failed (BigInt / circular ref); fall through to
            // storage._set, which handles the error itself, but don't cache an
            // un-fingerprinted write.
            fingerprint = undefined
        }

        // Record the fingerprint (and clear the dirty flag, mark persisted) only
        // after a confirmed-successful durable write: localStorage / sessionStorage
        // swallow quota errors, so caching ahead of a failed write would skip
        // every future retry and silently lose the entry.
        if (storage._set(name, props, this._expire_days, this._cross_subdomain, this._secure, this._config.debug)) {
            state.dirty = false
            if (slot !== MAIN_STORAGE_SLOT) {
                // The group entry has now actually landed on disk — only here is
                // it correct to record it as persisted (gates the empty-entry
                // skip in `_writeNowSplit`).
                state.persisted = true
            }
            if (!isUndefined(fingerprint)) {
                state.fingerprint = fingerprint
            }
            return true
        } else if (this._config.debug) {
            // The durable write did not land (e.g. localStorage quota). The slot
            // stays dirty / un-fingerprinted so the next save retries it; surface
            // it under debug so a repeated failure on a group entry — which would
            // otherwise silently strand the flag cache — is visible.
            logger.warn(`failed to persist storage entry "${name}"; will retry on next save`)
        }
        return false
    }

    // `keepGroupEntries` is set by the cookie-option setters (set_secure /
    // set_cross_subdomain). A cookie-scope change has to clear the cookie-backed
    // main entry, but the group entries are localStorage-only and entirely
    // scope-independent, so deleting and rewriting them would be the exact
    // per-page-load flag-blob churn the split exists to remove (these setters fire
    // once each on every construction, transitioning the in-memory option from
    // undefined to its configured value). Opt-out / reset (set_disabled / clear)
    // pass nothing and wipe everything.
    //
    // INVARIANT for `keepGroupEntries: true`: the caller must not also mutate
    // `props`. We keep the on-disk group entries AND their retained fingerprint;
    // that is only safe while `props` still matches what is on disk. The cookie
    // setters satisfy this (they touch only `_secure` / `_cross_subdomain`). A
    // future caller that clears or rewrites `props` while keeping the entries
    // would leave the retained fingerprint describing stale on-disk content and
    // skip the corrective write.
    remove({ keepGroupEntries = false }: { keepGroupEntries?: boolean } = {}): void {
        // Any write following this removal owns its complete feature-flag
        // snapshot and must not adopt the entry that was just removed.
        this._markAllCrossTabFeatureFlagChangesPending()
        // Cancel any pending debounced write — the storage entry is going
        // away so there is nothing useful to flush.
        if (!isUndefined(this._pendingSaveTimer)) {
            clearTimeout(this._pendingSaveTimer)
            this._pendingSaveTimer = undefined
        }
        // remove both domain and subdomain cookies
        this._storage._remove(this._name, false)
        this._storage._remove(this._name, true)
        // Wipe the group entries too — even when the split is currently off — so
        // a default flip-flop or version downgrade cannot strand an orphaned
        // flag entry that would leak across users on reset()/opt-out.
        // Only the owning instance does this: the sessionStorage sibling
        // posthog-core spins up shares this instance's storage name, so it must
        // not delete the localStorage owner's entries. localStorage-only.
        if (!keepGroupEntries && this._ownsSplitStorage) {
            for (const group of PERSISTENCE_STORAGE_GROUPS) {
                localStore._remove(this._groupEntryName(group))
            }
        }
        // The main entry is gone, so its bookkeeping must reset for the next
        // save to write through. When the group entries are kept, so is their
        // fingerprint/persisted state — that is what lets the following save
        // recognise them as unchanged and skip the rewrite.
        if (keepGroupEntries) {
            delete this._slotState[MAIN_STORAGE_SLOT]
        } else {
            this._slotState = {}
        }
        this._lastSeenCookiePropertiesFingerprint = undefined
        this._lastSeenMainCookieValue = undefined
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
            // Explicit local mutations are newer than any unobserved sibling
            // snapshot. Reconcile first so the caller's values win afterward.
            this.syncCookieProperties()
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
            this.syncCookieProperties()
            this._expire_days = isUndefined(days) ? this._default_expiry : days

            let hasChanges = false

            each(props, (val, prop) => {
                if (props.hasOwnProperty(prop) && (this.props[prop] !== val || isObject(val) || isArray(val))) {
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

    unregister(propOrProps: string | readonly string[]): void {
        this.syncCookieProperties()
        const props = typeof propOrProps === 'string' ? [propOrProps] : propOrProps
        let hasChanges = false
        for (const prop of props) {
            if (prop in this.props) {
                this._deleteProp(prop)
                hasChanges = true
            }
        }
        if (hasChanges) {
            this.save()
        }
    }

    update_campaign_params(): void {
        const currentUrl = document?.URL
        if (currentUrl === this._campaign_params_url) {
            return
        }

        const campaignParams = getCampaignParams(
            this._config.custom_campaign_params,
            this._config.mask_personal_data_properties,
            this._config.custom_personal_data_properties
        )
        // only save campaign params if there were any
        if (!isEmptyObject(stripEmptyProperties(campaignParams))) {
            this.register(campaignParams)
        }
        this._campaign_params_url = currentUrl
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
                    this._config.custom_personal_data_properties,
                    this._config.disable_capture_url_hashes
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
            const initialPersonProps = getInitialPersonPropsFromInfo(
                initialPersonInfo,
                this._config.disable_capture_url_hashes
            )
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
        const persistenceModeChanged = config.persistence !== oldConfig.persistence
        const cookiePersistedPropertiesChanged = !isArrayContentsEqual(
            config.cookie_persisted_properties || [],
            oldConfig.cookie_persisted_properties || []
        )
        const persistenceChanged = persistenceModeChanged || cookiePersistedPropertiesChanged
        const cookiePrecedenceChanged = config.cookieWinsOnConflict !== oldConfig.cookieWinsOnConflict

        const disabled = config['disable_persistence'] || !!isDisabled
        const reEnabling = !!this._disabled && !disabled
        // Reconcile through the old routing before replacing it. PostHog mutates
        // its config object before calling this method, so use the old snapshot
        // explicitly rather than relying on this._config. A configuration change
        // that re-enables persistence may read the shared cookie before writes resume.
        if (!disabled) {
            this._syncCookieProperties(oldConfig, reEnabling)
        }

        this._config = config
        // A newly enabled precedence policy or cookie-backed key set must apply
        // to the current cookie even if the old-policy sync just fingerprinted it.
        if (!disabled && (persistenceModeChanged || cookiePersistedPropertiesChanged || cookiePrecedenceChanged)) {
            this._lastSeenCookiePropertiesFingerprint = undefined
            this._lastSeenMainCookieValue = undefined
            // Newly added cookie-backed keys are still local-only in the current
            // cookie. Keep the old key set authoritative until migration writes
            // the first snapshot under the new configuration.
            this._syncCookieProperties(
                {
                    ...config,
                    cookie_persisted_properties: oldConfig.cookie_persisted_properties,
                },
                reEnabling
            )
        }

        // `_buildStorage` re-resolves both the backend and `_splitStorageEligible`,
        // so on a persistence change build the new store first, then derive the
        // split flag from the fresh eligibility. The new backend may no longer be
        // split-eligible (e.g. localStorage -> memory).
        const newStore = persistenceChanged || cookiePrecedenceChanged ? this._buildStorage(config) : this._storage
        const wantSplit = this._resolveSplitStorage(config)
        const storageMigration = persistenceChanged || wantSplit !== this._splitStorage
        const cookieOptionsChanged =
            config['cross_subdomain_cookie'] !== this._cross_subdomain || config['secure_cookie'] !== this._secure

        const cookieSyncSuppressionStarted =
            !disabled && (storageMigration || cookieOptionsChanged) && this._beginCookieSyncSuppression(reEnabling)
        // _buildStorage has already resolved the new backend eligibility, while
        // this._storage still points at the old backend until migration clears it.
        // Keep that authoritative migration snapshot intact until the swap.
        this._storageMigrationInProgress = storageMigration
        try {
            this._default_expiry = this._expire_days = config['cookie_expiration']
            this.set_disabled(disabled)
            this.set_cross_subdomain(config['cross_subdomain_cookie'])
            this.set_secure(config['secure_cookie'])

            // Migrate when the backend changed or the split routing flipped at
            // runtime, e.g. set_config({ split_storage: true }). Either way we
            // clear the old layout and re-save in the new routing.
            if (storageMigration) {
                const props = this.props
                this.clear()
                this._storage = newStore
                this._splitStorage = wantSplit
                this.props = props
                this.save()
            } else if (cookiePrecedenceChanged) {
                this._storage = newStore
                if (!disabled) {
                    // Persist the reconciled snapshot immediately. In particular,
                    // when precedence is disabled, a later reload must not let the
                    // stale localStorage value become authoritative again.
                    delete this._slotState[MAIN_STORAGE_SLOT]
                    this._writeNow()
                }
            }
        } finally {
            this._storageMigrationInProgress = false
            if (cookieSyncSuppressionStarted) {
                // Cookie option and storage migrations clear the shared cookie.
                // Restore one complete authoritative snapshot before another
                // subdomain can initialize.
                this._endCookieSyncSuppression()
            }
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
            this.remove({ keepGroupEntries: true })
            this.save()
        }
    }

    set_secure(secure: boolean): void {
        if (secure !== this._secure) {
            this._secure = secure
            this.remove({ keepGroupEntries: true })
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
        const previousValue = this.props[prop]
        this.props[prop] = to
        this._markPendingCrossTabFeatureFlagChanges(prop, previousValue, to)
        // A volatile value change never dirties its group — it changes on every
        // remote load and would otherwise force a rewrite of the large entry per
        // load. Deletions still dirty (see _deleteProp): presence is part of the
        // fingerprint, the moving value is not.
        if (!getPersistenceKeyPolicy(prop)?.volatile) {
            this._markGroupDirty(prop)
        }
    }

    private _deleteProp(prop: string): void {
        delete this.props[prop]
        if (isCrossTabFeatureFlagKey(prop)) {
            this._pendingCrossTabFeatureFlagChanges.set(prop, true)
        }
        this._markGroupDirty(prop)
    }

    // Mark the prop's storage group dirty so its entry is re-serialized on the
    // next write. Props with no group live in the main blob, which always writes.
    private _markGroupDirty(prop: string): void {
        const group = getPersistenceKeyPolicy(prop)?.storageGroup
        if (group) {
            this._slotWriteState(group).dirty = true
        }
    }

    // The write-bookkeeping record for a slot, created on first access.
    private _slotWriteState(slot: StorageSlot): SlotWriteState {
        return this._slotState[slot] || (this._slotState[slot] = {})
    }
}

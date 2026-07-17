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
    SURVEYS_LOADED_AT,
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

// Fingerprint slot for the main persistence entry. Group entries (`flags`)
// use their group name as the slot. See `_writeEntry`.
const MAIN_STORAGE_SLOT = 'main'

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

    /**
     * @param {PostHogConfig} config initial PostHog configuration
     * @param {boolean=} isDisabled should persistence be disabled (e.g. because of consent management)
     */
    constructor(config: PostHogConfig, isDisabled?: boolean, ownsSplitStorage: boolean = true) {
        this._config = config
        this._ownsSplitStorage = ownsSplitStorage
        this.props = {}
        this._campaign_params_saved = false
        this._name = parseName(config)
        this._storage = this._buildStorage(config)
        this._splitStorage = this._resolveSplitStorage(config)
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
        const localPlusCookieStore = createLocalPlusCookieStore(
            config['cookie_persisted_properties'] || [],
            config['__preview_cookie_wins_on_conflict'] || false
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
                if (policy?.shouldSkipFromEventProperties?.(v, () => false)) {
                    return
                }

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

        if (this._splitStorage) {
            this._loadGroupEntries()
        }
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

    private _writeNow(): void {
        if (this._disabled) {
            return
        }

        if (this._splitStorage) {
            this._writeNowSplit()
            return
        }

        this._writeEntry(this._storage, this._name, this.props, MAIN_STORAGE_SLOT)
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
        this._writeEntry(this._storage, this._name, main, MAIN_STORAGE_SLOT)
        for (const group of PERSISTENCE_STORAGE_GROUPS) {
            const groupProps = groups[group]
            // Don't materialize an entry just to hold `{}`: skip a group that is
            // empty and has never been persisted. Once a group has held content
            // we keep writing it (even when empty) so a later clear actually lands.
            if (isEmptyObject(groupProps) && !this._slotState[group]?.persisted) {
                continue
            }
            // `_writeEntry` marks the slot `persisted` (on `_slotState`) only
            // after a confirmed-successful `_set`, so a failed (e.g. quota) write
            // does not falsely mark the group as materialized on disk.
            this._writeEntry(localStore, this._groupEntryName(group), groupProps, group)
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
    private _writeEntry(storage: PersistentStore, name: string, props: Properties, slot: StorageSlot): void {
        const state = this._slotWriteState(slot)
        // Fast path for group slots (localStorage-only): when nothing in the
        // group changed since its last successful write, skip the JSON.stringify
        // of the large flag payload entirely. The main slot is excluded —
        // it is small, changes on nearly every write, and carries cookie options
        // in its fingerprint, so it always serializes.
        if (slot !== MAIN_STORAGE_SLOT && !state.dirty && !isUndefined(state.fingerprint)) {
            return
        }

        let fingerprint: string | undefined
        try {
            fingerprint = this._entryFingerprint(props, slot)
            if (fingerprint === state.fingerprint) {
                state.dirty = false
                return
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
        } else if (this._config.debug) {
            // The durable write did not land (e.g. localStorage quota). The slot
            // stays dirty / un-fingerprinted so the next save retries it; surface
            // it under debug so a repeated failure on a group entry — which would
            // otherwise silently strand the flag cache — is visible.
            logger.warn(`failed to persist storage entry "${name}"; will retry on next save`)
        }
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
        this._default_expiry = this._expire_days = config['cookie_expiration']
        this.set_disabled(config['disable_persistence'] || !!isDisabled)
        this.set_cross_subdomain(config['cross_subdomain_cookie'])
        this.set_secure(config['secure_cookie'])

        const persistenceChanged =
            config.persistence !== oldConfig.persistence ||
            !isArrayContentsEqual(config.cookie_persisted_properties || [], oldConfig.cookie_persisted_properties || [])

        // `_buildStorage` re-resolves both the backend and `_splitStorageEligible`,
        // so on a persistence change build the new store first, then derive the
        // split flag from the fresh eligibility. The new backend may no longer be
        // split-eligible (e.g. localStorage -> memory).
        const newStore = persistenceChanged ? this._buildStorage(config) : this._storage
        const wantSplit = this._resolveSplitStorage(config)

        // Migrate when the backend changed or the split routing flipped at
        // runtime, e.g. set_config({ split_storage: true })
        // without touching persistence. Either way we clear the old layout and
        // re-save so subsequent reads/writes land in the right entries.
        if (persistenceChanged || wantSplit !== this._splitStorage) {
            const props = this.props
            this.clear()
            this._storage = newStore
            this._splitStorage = wantSplit
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
        this.props[prop] = to
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

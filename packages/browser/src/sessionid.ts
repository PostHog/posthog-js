import { PostHogPersistence } from './posthog-persistence'
import { COOKIELESS_ALWAYS, DOM_EVENT_BEFOREUNLOAD, SESSION_ID } from './constants'
import { sessionStore } from './storage'
import { PostHogConfig, SessionIdChangedCallback } from './types'
import { uuid7ToTimestampMs, uuidv7 } from '@posthog/browser-common/utils/uuidv7'
import { window } from '@posthog/browser-common/utils/globals'

import { createLogger } from '@posthog/browser-common/utils/logger'

import { isArray, isNull, isUndefined, clampToRange, isPositiveNumber } from '@posthog/core'
import { PostHog } from './posthog-core'
import { addEventListener } from '@posthog/browser-common/utils/general-utils'
import { SimpleEventEmitter } from '@posthog/browser-common/utils/simple-event-emitter'

const logger = createLogger('[SessionId]')

export const DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS = 30 * 60 // 30 minutes
export const MAX_SESSION_IDLE_TIMEOUT_SECONDS = 10 * 60 * 60 // 10 hours
export const MIN_SESSION_IDLE_TIMEOUT_SECONDS = 60 // 1 minute
const SESSION_LENGTH_LIMIT_MILLISECONDS = 24 * 3600 * 1000 // 24 hours

// Must stay well under MIN_SESSION_IDLE_TIMEOUT_SECONDS so idle detection on
// other tabs cannot fire on stale persisted data (pinned by a unit test).
// Tradeoff: sibling tabs only observe activity once it has been persisted —
// in-memory ticks within this window are invisible across tabs.
export const ACTIVITY_TIMESTAMP_PERSIST_GRANULARITY_MS = 5_000

export class SessionIdManager {
    private readonly _sessionIdGenerator: () => string
    private readonly _windowIdGenerator: () => string
    private _config: Partial<PostHogConfig>
    private _persistence: PostHogPersistence
    private _windowId: string | null | undefined
    private _sessionId: string | null | undefined
    private readonly _window_id_storage_key: string
    private readonly _primary_window_exists_storage_key: string
    private _sessionStartTimestamp: number | null

    private _sessionActivityTimestamp: number | null
    private _lastPersistedActivityTimestamp: number | null = null
    private _sessionIdChangedHandlers: SessionIdChangedCallback[] = []
    private readonly _sessionTimeoutMs: number

    // we track activity so we can end the session proactively when it has passed the idle timeout
    private _enforceIdleTimeout: ReturnType<typeof setTimeout> | undefined

    private _beforeUnloadListener: (() => void) | undefined = undefined
    // Flipped to true by `destroy()` so a setTimeout callback that is
    // already queued can't re-arm itself onto a torn-down instance.
    private _destroyed: boolean = false

    private _eventEmitter: SimpleEventEmitter = new SimpleEventEmitter()
    public on(event: 'forcedIdleReset', handler: () => void): () => void {
        return this._eventEmitter.on(event, handler)
    }

    constructor(instance: PostHog, sessionIdGenerator?: () => string, windowIdGenerator?: () => string) {
        if (!instance.persistence) {
            throw new Error('SessionIdManager requires a PostHogPersistence instance')
        }
        if (instance.config.cookieless_mode === COOKIELESS_ALWAYS) {
            throw new Error('SessionIdManager cannot be used with cookieless_mode="always"')
        }

        this._config = instance.config
        this._persistence = instance.persistence
        this._windowId = undefined
        this._sessionId = undefined
        this._sessionStartTimestamp = null
        this._sessionActivityTimestamp = null
        this._sessionIdGenerator = sessionIdGenerator || uuidv7
        this._windowIdGenerator = windowIdGenerator || uuidv7

        const persistenceName = this._config['persistence_name'] || this._config['token']

        const desiredTimeout = this._config['session_idle_timeout_seconds'] || DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS
        this._sessionTimeoutMs =
            clampToRange(
                desiredTimeout,
                MIN_SESSION_IDLE_TIMEOUT_SECONDS,
                MAX_SESSION_IDLE_TIMEOUT_SECONDS,
                logger.createLogger('session_idle_timeout_seconds'),
                DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS
            ) * 1000

        instance.register({ $configured_session_timeout_ms: this._sessionTimeoutMs })
        this._resetIdleTimer()

        this._window_id_storage_key = 'ph_' + persistenceName + '_window_id'
        this._primary_window_exists_storage_key = 'ph_' + persistenceName + '_primary_window_exists'

        // primary_window_exists is set when the DOM has been loaded and is cleared on unload
        // if it exists here it means there was no unload which suggests this window is opened as a tab duplication, window.open, etc.
        if (this._canUseSessionStorage()) {
            const lastWindowId = sessionStore._parse(this._window_id_storage_key)

            const primaryWindowExists = sessionStore._parse(this._primary_window_exists_storage_key)
            if (lastWindowId && !primaryWindowExists) {
                // Persist window from previous storage state
                this._windowId = lastWindowId
            } else {
                // Wipe any reference to previous window id
                sessionStore._remove(this._window_id_storage_key)
            }
            // Flag this session as having a primary window
            sessionStore._set(this._primary_window_exists_storage_key, true)
        }

        if (this._config.bootstrap?.sessionID) {
            try {
                const sessionStartTimestamp = uuid7ToTimestampMs(this._config.bootstrap.sessionID)
                this._setSessionId(this._config.bootstrap.sessionID, new Date().getTime(), sessionStartTimestamp)
            } catch (e) {
                logger.error('Invalid sessionID in bootstrap', e)
            }
        }

        this._listenToReloadWindow()
    }

    get sessionTimeoutMs(): number {
        return this._sessionTimeoutMs
    }

    onSessionId(callback: SessionIdChangedCallback): () => void {
        // KLUDGE: when running in tests the handlers array was always undefined
        // it's yucky but safe to set it here so that it's always definitely available
        if (isUndefined(this._sessionIdChangedHandlers)) {
            this._sessionIdChangedHandlers = []
        }

        this._sessionIdChangedHandlers.push(callback)
        if (this._sessionId) {
            callback(this._sessionId, this._windowId)
        }
        return () => {
            this._sessionIdChangedHandlers = this._sessionIdChangedHandlers.filter((h) => h !== callback)
        }
    }

    private _canUseSessionStorage(): boolean {
        // We only want to use sessionStorage if persistence is enabled and not memory storage
        return this._config.persistence !== 'memory' && !this._persistence._disabled && sessionStore._is_supported()
    }

    // Note: this tries to store the windowId in sessionStorage. SessionStorage is unique to the current window/tab,
    // and persists page loads/reloads. So it's uniquely suited for storing the windowId. This function also respects
    // when persistence is disabled (by user config) and when sessionStorage is not supported (it *should* be supported on all browsers),
    // and in that case, it falls back to memory (which sadly, won't persist page loads)
    private _setWindowId(windowId: string): void {
        if (windowId !== this._windowId) {
            this._windowId = windowId
            if (this._canUseSessionStorage()) {
                sessionStore._set(this._window_id_storage_key, windowId)
            }
        }
    }

    private _getWindowId(): string | null {
        if (this._windowId) {
            return this._windowId
        }
        if (this._canUseSessionStorage()) {
            return sessionStore._parse(this._window_id_storage_key)
        }
        // New window id will be generated
        return null
    }

    private _isActivityChangeBelowGranularity(newActivityTimestamp: number | null): boolean {
        const lastPersisted = this._lastPersistedActivityTimestamp
        if (isNull(lastPersisted) || isNull(newActivityTimestamp)) {
            return false
        }
        // Math.abs guards against clock skew (NTP, devtools time travel) — a
        // backwards jump would otherwise slip past the gate.
        return Math.abs(newActivityTimestamp - lastPersisted) < ACTIVITY_TIMESTAMP_PERSIST_GRANULARITY_MS
    }

    // Note: 'this.persistence.register' can be disabled in the config.
    // In that case, this works by storing sessionId and the timestamp in memory.
    private _setSessionId(
        sessionId: string | null,
        sessionActivityTimestamp: number | null,
        sessionStartTimestamp: number | null
    ): void {
        const idChanged = sessionId !== this._sessionId
        const startChanged = sessionStartTimestamp !== this._sessionStartTimestamp
        const activityChanged = sessionActivityTimestamp !== this._sessionActivityTimestamp
        const isActivityOnlyChange = !idChanged && !startChanged

        // In-memory state always tracks the freshest values, even when the
        // write below is throttled, so in-process reads stay accurate.
        this._sessionStartTimestamp = sessionStartTimestamp
        this._sessionActivityTimestamp = sessionActivityTimestamp
        this._sessionId = sessionId

        if (isActivityOnlyChange && !activityChanged) {
            return
        }

        if (isActivityOnlyChange && this._isActivityChangeBelowGranularity(sessionActivityTimestamp)) {
            return
        }

        this._lastPersistedActivityTimestamp = sessionActivityTimestamp
        this._persistence.register({
            [SESSION_ID]: [sessionActivityTimestamp, sessionId, sessionStartTimestamp],
        })
    }

    // Gates the debounce-specific cross-tab storage mechanics. The cross-tab
    // refresh on the idle path, the idle-timer re-arm, sibling-session
    // adoption, and `onSessionId` emission all run for all callers — only the
    // per-key SESSION_ID refresh (vs the legacy whole-blob flush()+load(),
    // which can only clobber a sibling when there is a pending debounced
    // write) is gated on debounce being enabled. The dated default
    // (>= 2026-05-30) enables debounce, so the per-key path ships with it;
    // debounce-disabled callers keep the safe legacy refresh.
    private _useCrossTabRefreshHardening(): boolean {
        const debounce = this._config?.persistence_save_debounce_ms
        return isPositiveNumber(debounce) && debounce > 0
    }

    // Refresh this tab's SESSION_ID view from storage to pick up a sibling
    // tab's writes. With debounce enabled, pull only the SESSION_ID slot — a
    // whole-blob flush() would clobber the sibling's SESSION_ID write before
    // we read it. With debounce disabled, flush() is a no-op (no pending
    // timer) so the legacy whole-blob load() is safe and picks up sibling
    // writes.
    private _refreshSessionIdFromStorage(): void {
        if (this._useCrossTabRefreshHardening()) {
            this._persistence.refreshKey(SESSION_ID)
        } else {
            this._persistence.flush()
            this._persistence.load()
        }
    }

    // Called from destroy / beforeunload so a tab close inside the throttle
    // window doesn't leave the persisted activity timestamp stale.
    private _flushPendingActivityTimestamp(): void {
        if (
            isNull(this._sessionActivityTimestamp) ||
            this._sessionActivityTimestamp === this._lastPersistedActivityTimestamp
        ) {
            return
        }

        // A sibling tab may have rotated the session — refresh and skip the
        // write if storage no longer matches our cached id/start, otherwise
        // we would clobber the sibling's new session with stale values.
        this._refreshSessionIdFromStorage()
        const [, persistedSessionId, persistedStart] = this._getSessionId()
        if (persistedSessionId !== this._sessionId || persistedStart !== this._sessionStartTimestamp) {
            return
        }

        this._lastPersistedActivityTimestamp = this._sessionActivityTimestamp
        this._persistence.register({
            [SESSION_ID]: [this._sessionActivityTimestamp, this._sessionId ?? null, this._sessionStartTimestamp],
        })
        // Force the write past the debounce — destroy / unload paths cannot
        // wait for a deferred timer that will never fire.
        this._persistence.flush()
    }

    // `max` because either view can be ahead: the throttle holds in-memory
    // ahead of persisted, and a sibling tab can hold persisted ahead of a
    // frozen in-memory.
    private _freshestActivityTimestamp(): number {
        const [persistedActivity] = this._getSessionId()
        const persisted = isPositiveNumber(persistedActivity) ? persistedActivity : 0
        const inMemory = isPositiveNumber(this._sessionActivityTimestamp) ? this._sessionActivityTimestamp : 0
        return Math.max(persisted, inMemory)
    }

    // PostHogPersistence does not listen for `storage` events, so this tab's
    // cached props lag sibling tabs' writes. Refresh before deciding idle so a
    // sibling keeping the session alive isn't seen as idle here.
    private _isSessionIdleAfterCrossTabRefresh(timestamp: number): boolean {
        this._refreshSessionIdFromStorage()
        return this._sessionHasBeenIdleTooLong(timestamp, this._freshestActivityTimestamp())
    }

    private _getSessionId(): [number, string, number] {
        // Always read from persistence - it's the source of truth
        // The in-memory cache could become stale (e.g., in a frozen tab scenario where
        // time passes but the cache isn't updated)
        const sessionIdInfo = this._persistence.props[SESSION_ID]

        if (isArray(sessionIdInfo) && sessionIdInfo.length === 2) {
            // Storage does not yet have a session start time. Add the last activity timestamp as the start time
            sessionIdInfo.push(sessionIdInfo[0])
        }

        return sessionIdInfo || [0, null, 0]
    }

    // Resets the session id by setting it to null. On the subsequent call to checkAndGetSessionAndWindowId,
    // new ids will be generated. Also clears the idle timer so a stale fire
    // cannot rotate the freshly-cleared session.
    resetSessionId(): void {
        this._lastPersistedActivityTimestamp = null
        clearTimeout(this._enforceIdleTimeout)
        this._enforceIdleTimeout = undefined
        this._setSessionId(null, null, null)
    }

    /**
     * Cleans up resources used by SessionIdManager.
     * Should be called when the SessionIdManager is no longer needed to prevent memory leaks.
     */
    destroy(): void {
        this._destroyed = true
        this._flushPendingActivityTimestamp()

        // Clear the idle timeout timer
        clearTimeout(this._enforceIdleTimeout)
        this._enforceIdleTimeout = undefined

        // Remove the beforeunload event listener
        if (this._beforeUnloadListener && window) {
            window.removeEventListener(DOM_EVENT_BEFOREUNLOAD, this._beforeUnloadListener, { capture: false } as any)
            this._beforeUnloadListener = undefined
        }

        // Clear session id changed handlers
        this._sessionIdChangedHandlers = []
    }

    /*
     * Listens to window unloads and removes the primaryWindowExists key from sessionStorage.
     * Reloaded or fresh tabs created after a DOM unloads (reloading the same tab) WILL NOT have this primaryWindowExists flag in session storage.
     * Cloned sessions (new tab, tab duplication, window.open(), ...) WILL have this primaryWindowExists flag in their copied session storage.
     * We conditionally check the primaryWindowExists value in the constructor to decide if the window id in the last session storage should be carried over.
     */
    private _listenToReloadWindow(): void {
        this._beforeUnloadListener = () => {
            this._flushPendingActivityTimestamp()
            if (this._canUseSessionStorage()) {
                sessionStore._remove(this._primary_window_exists_storage_key)
            }
        }
        addEventListener(window, DOM_EVENT_BEFOREUNLOAD, this._beforeUnloadListener, { capture: false })
    }

    private _sessionHasBeenIdleTooLong = (timestamp: unknown, lastActivityTimestamp: unknown): boolean => {
        if (!isPositiveNumber(timestamp) || !isPositiveNumber(lastActivityTimestamp)) {
            return false
        }
        return Math.abs(timestamp - lastActivityTimestamp) > this.sessionTimeoutMs
    }

    /*
     * This function returns the current sessionId and windowId. It should be used to
     * access these values over directly calling `._sessionId` or `._windowId`.
     * In addition to returning the sessionId and windowId, this function also manages cycling the
     * sessionId and windowId when appropriate by doing the following:
     *
     * 1. If the sessionId or windowId is not set, it will generate a new one and store it.
     * 2. If the readOnly param is set to false, it will:
     *    a. Check if it has been > SESSION_CHANGE_THRESHOLD since the last call with this flag set.
     *       If so, it will generate a new sessionId and store it.
     *    b. Update the timestamp stored with the sessionId to ensure the current session is extended
     *       for the appropriate amount of time.
     *
     * @param {boolean} readOnly (optional) Defaults to False. Should be set to True when the call to the function should not extend or cycle the session (e.g. being called for non-user generated events)
     * @param {Number} timestamp (optional) Defaults to the current time. The timestamp to be stored with the sessionId (used when determining if a new sessionId should be generated)
     */
    checkAndGetSessionAndWindowId(readOnly = false, _timestamp: number | null = null) {
        if (this._config.cookieless_mode === COOKIELESS_ALWAYS) {
            throw new Error('checkAndGetSessionAndWindowId should not be called with cookieless_mode="always"')
        }
        const timestamp = _timestamp || new Date().getTime()

        let [, sessionId, startTimestamp] = this._getSessionId()
        const lastActivityTimestamp = this._freshestActivityTimestamp()
        let windowId = this._getWindowId()

        const sessionPastMaximumLength =
            isPositiveNumber(startTimestamp) && Math.abs(timestamp - startTimestamp) > SESSION_LENGTH_LIMIT_MILLISECONDS

        let valuesChanged = false
        let crossTabAdoption = false
        const noSessionId = !sessionId
        const preRefreshSessionId = sessionId
        let activityTimeout =
            !noSessionId && !readOnly && this._sessionHasBeenIdleTooLong(timestamp, lastActivityTimestamp)
        if (activityTimeout) {
            // Re-check against the freshest cross-tab view: a sibling tab
            // may have kept the session alive.
            activityTimeout = this._isSessionIdleAfterCrossTabRefresh(timestamp)
            if (!activityTimeout) {
                // The rare, timing-dependent case this path exists for: a
                // sibling kept the session alive, so we avoid a spurious
                // rotation. Logged because it is otherwise invisible in the
                // wild and hard to reproduce.
                logger.info('cross-tab refresh kept the session alive', { sessionId })
            }
            // The cross-tab refresh may have observed a sibling tab's
            // session rotation. Re-sample sessionId / startTimestamp so we
            // don't clobber the sibling's new session with our stale id when
            // we write below. (`_flushPendingActivityTimestamp` re-reads the
            // same way on the unload path, but bails instead of adopting.)
            ;[, sessionId, startTimestamp] = this._getSessionId()
        }
        if (noSessionId || activityTimeout || sessionPastMaximumLength) {
            sessionId = this._sessionIdGenerator()
            windowId = this._windowIdGenerator()
            logger.info('new session ID generated', {
                sessionId,
                windowId,
                changeReason: { noSessionId, activityTimeout, sessionPastMaximumLength },
            })
            startTimestamp = timestamp
            valuesChanged = true
        } else {
            if (!windowId) {
                windowId = this._windowIdGenerator()
                valuesChanged = true
            }
            // Not gated on debounce: the refresh + re-sample above run for all
            // callers, so adoption can happen for all callers — and a session id
            // change that handlers don't hear about leaves consumers (page-view
            // state, a stopped recorder, session-scoped props) on the old
            // session. If we adopted, we must notify.
            crossTabAdoption = sessionId !== preRefreshSessionId
            if (crossTabAdoption) {
                // We took a sibling tab's session id (keeping our own window
                // id). Fire handlers so downstream consumers (session
                // recorder, session-scoped props, $pageview) follow the new
                // session.
                logger.info('adopted cross-tab session id', { sessionId, windowId })
                valuesChanged = true
            }
        }

        const noActivityTimestamp = !isPositiveNumber(lastActivityTimestamp)
        const shouldPreserveActivityTimestamp = !noActivityTimestamp && readOnly && !sessionPastMaximumLength
        const newActivityTimestamp = shouldPreserveActivityTimestamp ? lastActivityTimestamp : timestamp

        const noStartTimestamp = !isPositiveNumber(startTimestamp)
        const sessionStartTimestamp = noStartTimestamp ? new Date().getTime() : startTimestamp

        this._setWindowId(windowId)
        this._setSessionId(sessionId, newActivityTimestamp, sessionStartTimestamp)

        if (!readOnly) {
            this._resetIdleTimer()
        }

        const changeReason = { noSessionId, activityTimeout, sessionPastMaximumLength, crossTabAdoption }
        if (valuesChanged) {
            this._sessionIdChangedHandlers.forEach((handler) => handler(sessionId, windowId, changeReason))
        }

        return {
            sessionId,
            windowId,
            sessionStartTimestamp,
            changeReason: valuesChanged ? changeReason : undefined,
            lastActivityTimestamp: lastActivityTimestamp,
        }
    }

    private _resetIdleTimer() {
        if (this._destroyed) {
            // The instance has been torn down. Don't schedule any more
            // work — a setTimeout callback queued before destroy could
            // otherwise re-arm onto a dead manager and fire after teardown.
            return
        }
        clearTimeout(this._enforceIdleTimeout)
        this._enforceIdleTimeout = setTimeout(() => {
            if (this._destroyed) {
                return
            }
            if (this._isSessionIdleAfterCrossTabRefresh(new Date().getTime())) {
                const idleSessionId = this._sessionId
                this.resetSessionId()
                this._eventEmitter.emit('forcedIdleReset', { idleSessionId })
            } else {
                // A sibling tab kept the session alive — re-arm so we
                // re-check after another timeout window. This is unbounded by
                // design: a session with at least one active tab re-arms
                // indefinitely until every tab goes idle (or is destroyed —
                // guarded by the check above). We deliberately do NOT adopt a
                // sibling's rotated id here; adoption is scoped to the event
                // path (checkAndGetSessionAndWindowId), and this tab picks up
                // any rotation on its next event.
                this._resetIdleTimer()
            }
        }, this.sessionTimeoutMs * 1.1)
    }
}

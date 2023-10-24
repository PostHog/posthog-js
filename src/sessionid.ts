import { PostHogPersistence } from './posthog-persistence'
import { SESSION_ID } from './constants'
import { sessionStore } from './storage'
import { PostHogConfig, SessionIdChangedCallback } from './types'
import { uuidv7 } from './uuidv7'
import { _isArray, _isNumber, _isUndefined, logger, window } from './utils'

const MAX_SESSION_IDLE_TIMEOUT = 30 * 60 // 30 minutes
const MIN_SESSION_IDLE_TIMEOUT = 60 // 1 minute
const SESSION_LENGTH_LIMIT = 24 * 3600 * 1000 // 24 hours

export class SessionIdManager {
    private readonly _sessionIdGenerator: () => string
    private readonly _windowIdGenerator: () => string
    private config: Partial<PostHogConfig>
    private persistence: PostHogPersistence
    private _windowId: string | null | undefined
    private _sessionId: string | null | undefined
    private readonly _window_id_storage_key: string
    private readonly _primary_window_exists_storage_key: string
    private _sessionStartTimestamp: number | null

    private _sessionActivityTimestamp: number | null
    private readonly _sessionTimeoutMs: number
    private _sessionIdChangedHandlers: SessionIdChangedCallback[] = []

    constructor(
        config: Partial<PostHogConfig>,
        persistence: PostHogPersistence,
        sessionIdGenerator?: () => string,
        windowIdGenerator?: () => string
    ) {
        this.config = config
        this.persistence = persistence
        this._windowId = undefined
        this._sessionId = undefined
        this._sessionStartTimestamp = null
        this._sessionActivityTimestamp = null
        this._sessionIdGenerator = sessionIdGenerator || uuidv7
        this._windowIdGenerator = windowIdGenerator || uuidv7

        const persistenceName = config['persistence_name'] || config['token']
        let desiredTimeout = config['session_idle_timeout_seconds'] || MAX_SESSION_IDLE_TIMEOUT

        if (!_isNumber(desiredTimeout)) {
            logger.warn('session_idle_timeout_seconds must be a number. Defaulting to 30 minutes.')
            desiredTimeout = MAX_SESSION_IDLE_TIMEOUT
        } else if (desiredTimeout > MAX_SESSION_IDLE_TIMEOUT) {
            logger.warn('session_idle_timeout_seconds cannot be  greater than 30 minutes. Using 30 minutes instead.')
        } else if (desiredTimeout < MIN_SESSION_IDLE_TIMEOUT) {
            logger.warn('session_idle_timeout_seconds cannot be less than 60 seconds. Using 60 seconds instead.')
        }

        this._sessionTimeoutMs =
            Math.min(Math.max(desiredTimeout, MIN_SESSION_IDLE_TIMEOUT), MAX_SESSION_IDLE_TIMEOUT) * 1000
        this._window_id_storage_key = 'ph_' + persistenceName + '_window_id'
        this._primary_window_exists_storage_key = 'ph_' + persistenceName + '_primary_window_exists'

        // primary_window_exists is set when the DOM has been loaded and is cleared on unload
        // if it exists here it means there was no unload which suggests this window is opened as a tab duplication, window.open, etc.
        if (this._canUseSessionStorage()) {
            const lastWindowId = sessionStore.parse(this._window_id_storage_key)

            const primaryWindowExists = sessionStore.parse(this._primary_window_exists_storage_key)
            if (lastWindowId && !primaryWindowExists) {
                // Persist window from previous storage state
                this._windowId = lastWindowId
            } else {
                // Wipe any reference to previous window id
                sessionStore.remove(this._window_id_storage_key)
            }
            // Flag this session as having a primary window
            sessionStore.set(this._primary_window_exists_storage_key, true)
        }

        this._listenToReloadWindow()
    }

    onSessionId(callback: SessionIdChangedCallback): () => void {
        // KLUDGE: when running in tests the handlers array was always undefined
        // it's yucky but safe to set it here so that it's always definitely available
        if (_isUndefined(this._sessionIdChangedHandlers)) {
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
        return this.config.persistence !== 'memory' && !this.persistence.disabled && sessionStore.is_supported()
    }

    // Note: this tries to store the windowId in sessionStorage. SessionStorage is unique to the current window/tab,
    // and persists page loads/reloads. So it's uniquely suited for storing the windowId. This function also respects
    // when persistence is disabled (by user config) and when sessionStorage is not supported (it *should* be supported on all browsers),
    // and in that case, it falls back to memory (which sadly, won't persist page loads)
    private _setWindowId(windowId: string): void {
        if (windowId !== this._windowId) {
            this._windowId = windowId
            if (this._canUseSessionStorage()) {
                sessionStore.set(this._window_id_storage_key, windowId)
            }
        }
    }

    private _getWindowId(): string | null {
        if (this._windowId) {
            return this._windowId
        }
        if (this._canUseSessionStorage()) {
            return sessionStore.parse(this._window_id_storage_key)
        }
        // New window id will be generated
        return null
    }

    // Note: 'this.persistence.register' can be disabled in the config.
    // In that case, this works by storing sessionId and the timestamp in memory.
    private _setSessionId(
        sessionId: string | null,
        sessionActivityTimestamp: number | null,
        sessionStartTimestamp: number | null
    ): void {
        if (
            sessionId !== this._sessionId ||
            sessionActivityTimestamp !== this._sessionActivityTimestamp ||
            sessionStartTimestamp !== this._sessionStartTimestamp
        ) {
            this._sessionStartTimestamp = sessionStartTimestamp
            this._sessionActivityTimestamp = sessionActivityTimestamp
            this._sessionId = sessionId

            this.persistence.register({
                [SESSION_ID]: [sessionActivityTimestamp, sessionId, sessionStartTimestamp],
            })
        }
    }

    private _getSessionId(): [number, string, number] {
        if (this._sessionId && this._sessionActivityTimestamp && this._sessionStartTimestamp) {
            return [this._sessionActivityTimestamp, this._sessionId, this._sessionStartTimestamp]
        }
        const sessionId = this.persistence.props[SESSION_ID]

        if (_isArray(sessionId) && sessionId.length === 2) {
            // Storage does not yet have a session start time. Add the last activity timestamp as the start time
            sessionId.push(sessionId[0])
        }

        return sessionId || [0, null, 0]
    }

    // Resets the session id by setting it to null. On the subsequent call to checkAndGetSessionAndWindowId,
    // new ids will be generated.
    resetSessionId(): void {
        this._setSessionId(null, null, null)
    }

    /*
     * Listens to window unloads and removes the primaryWindowExists key from sessionStorage.
     * Reloaded or fresh tabs created after a DOM unloads (reloading the same tab) WILL NOT have this primaryWindowExists flag in session storage.
     * Cloned sessions (new tab, tab duplication, window.open(), ...) WILL have this primaryWindowExists flag in their copied session storage.
     * We conditionally check the primaryWindowExists value in the constructor to decide if the window id in the last session storage should be carried over.
     */
    private _listenToReloadWindow(): void {
        window.addEventListener('beforeunload', () => {
            if (this._canUseSessionStorage()) {
                sessionStore.remove(this._primary_window_exists_storage_key)
            }
        })
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
        const timestamp = _timestamp || new Date().getTime()

        // eslint-disable-next-line prefer-const
        let [lastTimestamp, sessionId, startTimestamp] = this._getSessionId()
        let windowId = this._getWindowId()

        const sessionPastMaximumLength =
            startTimestamp && startTimestamp > 0 && Math.abs(timestamp - startTimestamp) > SESSION_LENGTH_LIMIT

        let valuesChanged = false
        const noSessionId = !sessionId
        const activityTimeout = !readOnly && Math.abs(timestamp - lastTimestamp) > this._sessionTimeoutMs
        if (noSessionId || activityTimeout || sessionPastMaximumLength) {
            sessionId = this._sessionIdGenerator()
            windowId = this._windowIdGenerator()
            startTimestamp = timestamp
            valuesChanged = true
        } else if (!windowId) {
            windowId = this._windowIdGenerator()
            valuesChanged = true
        }

        const newTimestamp = lastTimestamp === 0 || !readOnly || sessionPastMaximumLength ? timestamp : lastTimestamp
        const sessionStartTimestamp = startTimestamp === 0 ? new Date().getTime() : startTimestamp

        this._setWindowId(windowId)
        this._setSessionId(sessionId, newTimestamp, sessionStartTimestamp)

        if (valuesChanged) {
            this._sessionIdChangedHandlers.forEach((handler) => handler(sessionId, windowId))
        }

        return {
            sessionId,
            windowId,
            sessionStartTimestamp,
        }
    }
}

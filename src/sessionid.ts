import { PostHogPersistence, SESSION_ID } from './posthog-persistence'
import { sessionStore } from './storage'
import { _UUID } from './utils'
import { PostHogConfig } from './types'

const SESSION_CHANGE_THRESHOLD = 30 * 60 * 1000 // 30 mins
const SESSION_LENGTH_LIMIT = 24 * 3600 * 1000 // 24 hours

export class SessionIdManager {
    config: Partial<PostHogConfig>
    persistence: PostHogPersistence
    _windowId: string | null | undefined
    _sessionId: string | null | undefined
    window_id_storage_key: string
    primary_window_exists_storage_key: string
    _sessionStartTimestamp: number | null
    _sessionActivityTimestamp: number | null

    constructor(config: Partial<PostHogConfig>, persistence: PostHogPersistence) {
        this.config = config
        this.persistence = persistence
        this._windowId = undefined
        this._sessionId = undefined
        this._sessionStartTimestamp = null
        this._sessionActivityTimestamp = null

        const persistenceName = config['persistence_name'] || config['token']

        this.window_id_storage_key = 'ph_' + persistenceName + '_window_id'
        this.primary_window_exists_storage_key = 'ph_' + persistenceName + '_primary_window_exists'

        // primary_window_exists is set when the DOM has been loaded and is cleared on unload
        // if it exists here it means there was no unload which suggests this window is opened as a tab duplication, window.open, etc.
        if (this._canUseSessionStorage()) {
            const lastWindowId = sessionStore.parse(this.window_id_storage_key)

            const primaryWindowExists = sessionStore.parse(this.primary_window_exists_storage_key)
            if (lastWindowId && !primaryWindowExists) {
                // Persist window from previous storage state
                this._windowId = lastWindowId
            } else {
                // Wipe any reference to previous window id
                sessionStore.remove(this.window_id_storage_key)
            }
            // Flag this session as having a primary window
            sessionStore.set(this.primary_window_exists_storage_key, true)
        }

        this._listenToReloadWindow()
    }

    _canUseSessionStorage(): boolean {
        // We only want to use sessionStorage if persistence is enabled and not memory storage
        return this.config.persistence !== 'memory' && !this.persistence.disabled && sessionStore.is_supported()
    }

    // Note: this tries to store the windowId in sessionStorage. SessionStorage is unique to the current window/tab,
    // and persists page loads/reloads. So it's uniquely suited for storing the windowId. This function also respects
    // when persistence is disabled (by user config) and when sessionStorage is not supported (it *should* be supported on all browsers),
    // and in that case, it falls back to memory (which sadly, won't persist page loads)
    _setWindowId(windowId: string): void {
        if (windowId !== this._windowId) {
            this._windowId = windowId
            if (this._canUseSessionStorage()) {
                sessionStore.set(this.window_id_storage_key, windowId)
            }
        }
    }

    _getWindowId(): string | null {
        if (this._windowId) {
            return this._windowId
        }
        if (this._canUseSessionStorage()) {
            return sessionStore.parse(this.window_id_storage_key)
        }
        // New window id will be generated
        return null
    }

    // Note: 'this.persistence.register' can be disabled in the config.
    // In that case, this works by storing sessionId and the timestamp in memory.
    _setSessionId(
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

    _getSessionId(): [number, string, number] {
        if (this._sessionId && this._sessionActivityTimestamp && this._sessionStartTimestamp) {
            return [this._sessionActivityTimestamp, this._sessionId, this._sessionStartTimestamp]
        }
        const sessionId = this.persistence.props[SESSION_ID]

        if (Array.isArray(sessionId) && sessionId.length === 2) {
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
    _listenToReloadWindow(): void {
        window.addEventListener('beforeunload', () => {
            if (this._canUseSessionStorage()) {
                sessionStore.remove(this.primary_window_exists_storage_key)
            }
        })
    }

    /*
     * This function returns the current sessionId and windowId. It should be used to
     * access these values over directly calling `._sessionId` or `._windowId`. In addition
     * to returning the sessionId and windowId, this function also manages cycling the
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

        if (
            !sessionId ||
            (!readOnly && Math.abs(timestamp - lastTimestamp) > SESSION_CHANGE_THRESHOLD) ||
            sessionPastMaximumLength
        ) {
            sessionId = _UUID()
            windowId = _UUID()
            startTimestamp = timestamp
        } else if (!windowId) {
            windowId = _UUID()
        }

        const newTimestamp = lastTimestamp === 0 || !readOnly || sessionPastMaximumLength ? timestamp : lastTimestamp
        const sessionStartTimestamp = startTimestamp === 0 ? new Date().getTime() : startTimestamp

        this._setWindowId(windowId)
        this._setSessionId(sessionId, newTimestamp, sessionStartTimestamp)

        return {
            sessionId: sessionId,
            windowId: windowId,
        }
    }
}

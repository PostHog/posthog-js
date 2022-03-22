import { SESSION_ID } from './posthog-persistence'
import { sessionStore } from './storage'
import { _ } from './utils'

const SESSION_CHANGE_THRESHOLD = 30 * 60 * 1000 // 30 mins

export class SessionIdManager {
    constructor(config, persistence) {
        this.persistence = persistence

        if (config['persistence_name']) {
            this.window_id_storage_key = 'ph_' + config['persistence_name'] + '_window_id'
        } else {
            this.window_id_storage_key = 'ph_' + config['token'] + '_window_id'
        }
    }

    // Note: this tries to store the windowId in sessionStorage. SessionStorage is unique to the current window/tab,
    // and persists page loads/reloads. So it's uniquely suited for storing the windowId. This function also respects
    // when persistence is disabled (by user config) and when sessionStorage is not supported (it *should* be supported on all browsers),
    // and in that case, it falls back to memory (which sadly, won't persist page loads)
    _setWindowId(windowId) {
        if (windowId !== this._windowId) {
            this._windowId = windowId
            if (!this.persistence.disabled && sessionStore.is_supported()) {
                sessionStore.set(this.window_id_storage_key, windowId)
            }
        }
    }

    _getWindowId() {
        if (this._windowId) {
            return this._windowId
        }
        if (!this.persistence.disabled && sessionStore.is_supported()) {
            return sessionStore.parse(this.window_id_storage_key)
        }
        return null
    }

    // Note: 'this.persistence.register' can be disabled in the config.
    // In that case, this works by storing sessionId and the timestamp in memory.
    _setSessionId(sessionId, timestamp) {
        if (sessionId !== this._sessionId || timestamp !== this._timestamp) {
            this._timestamp = timestamp
            this._sessionId = sessionId
            this.persistence.register({ [SESSION_ID]: [timestamp, sessionId] })
        }
    }

    _getSessionId() {
        if (this._sessionId && this._timestamp) {
            return [this._timestamp, this._sessionId]
        }
        return this.persistence['props'][SESSION_ID] || [0, null]
    }

    // Resets the session id by setting it to null. On the subsequent call to checkAndGetSessionAndWindowId,
    // new ids will be generated.
    resetSessionId() {
        this._setSessionId(null, null)
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
    checkAndGetSessionAndWindowId(readOnly = false, timestamp = null) {
        timestamp = timestamp || new Date().getTime()

        let [lastTimestamp, sessionId] = this._getSessionId()
        let windowId = this._getWindowId()

        if (!sessionId || (!readOnly && Math.abs(timestamp - lastTimestamp) > SESSION_CHANGE_THRESHOLD)) {
            sessionId = _.UUID()
            windowId = _.UUID()
        } else if (!windowId) {
            windowId = _.UUID()
        }

        const newTimestamp = lastTimestamp === 0 || !readOnly ? timestamp : lastTimestamp

        this._setWindowId(windowId)
        this._setSessionId(sessionId, newTimestamp)

        return {
            sessionId: sessionId,
            windowId: windowId,
        }
    }
}

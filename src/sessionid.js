import { INCREMENTAL_SNAPSHOT_EVENT_TYPE, MUTATION_SOURCE_TYPE } from './extensions/sessionrecording'
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
        if (windowId !== this.windowId) {
            this.windowId = windowId
            if (!this.persistence.disabled && sessionStore.is_supported()) {
                sessionStore.set(this.window_id_storage_key, windowId)
            }
        }
    }

    _getWindowId() {
        if (this.windowId) {
            return this.windowId
        }
        if (!this.persistence.disabled && sessionStore.is_supported()) {
            return sessionStore.parse(this.window_id_storage_key)
        }
        return null
    }

    // Note: 'this.persistence.register' can be disabled in the config.
    // In that case, this works by storing sessionId and the timestamp in memory.
    _setSessionId(sessionId, timestamp) {
        if (sessionId !== this.sessionId || timestamp !== this.timestamp) {
            this.timestamp = timestamp
            this.sessionId = sessionId
            this.persistence.register({ [SESSION_ID]: [timestamp, sessionId] })
        }
    }

    _getSessionId() {
        if (this.sessionId && this.timestamp) {
            return [this.timestamp, this.sessionId]
        }
        return this.persistence['props'][SESSION_ID] || [0, null]
    }

    getSessionAndWindowId(timestamp = null, recordingEvent = false) {
        // Some recording events are triggered by non-user events (e.g. "X minutes ago" text updating on the screen).
        // We don't want to update the session and window ids in these cases. These events are designated by event
        // type -> incremental update, and source -> mutation.
        let isUserInteraction = !(
            recordingEvent &&
            recordingEvent.type === INCREMENTAL_SNAPSHOT_EVENT_TYPE &&
            recordingEvent.data?.source === MUTATION_SOURCE_TYPE
        )

        let [lastTimestamp, sessionId] = this._getSessionId()
        let windowId = this._getWindowId()

        if (!sessionId || (isUserInteraction && Math.abs(timestamp - lastTimestamp) > SESSION_CHANGE_THRESHOLD)) {
            sessionId = _.UUID()
            windowId = _.UUID()
        } else if (!windowId) {
            windowId = _.UUID()
        }

        const newTimestamp = lastTimestamp === 0 || isUserInteraction ? timestamp || new Date() : lastTimestamp

        this._setWindowId(windowId)
        this._setSessionId(sessionId, newTimestamp)

        return {
            sessionId: sessionId,
            windowId: windowId,
        }
    }
}

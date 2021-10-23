import { SESSION_ID } from './posthog-persistence'
import { sessionStore } from './storage'
import { _ } from './utils'

const SESSION_CHANGE_THRESHOLD = 30 * 60 * 1000 // 30 mins

export class SessionIdManager {
    constructor(config, persistence) {
        this.config = config
        this.persistence = persistence

        if (this.config['persistence_name']) {
            this.window_id_key = 'ph_' + this.config['persistence_name'] + '_window_id'
        } else {
            this.window_id_key = 'ph_' + this.config['token'] + '_posthog_window_id'
        }
    }

    getWindowId() {
        if (this.windowId) {
            return this.windowId
        }
        return sessionStore.get(this.window_id_key)
    }

    setWindowId(windowId) {
        if (windowId !== this.windowId) {
            this.windowId = windowId
            sessionStore.set(this.window_id_key, windowId)
        }
    }

    getSessionAndWindowId(timestamp = null, shouldRefreshIfExpired = true) {
        if (timestamp === null) {
            timestamp = new Date()
        }
        let [lastTimestamp, sessionId] = this.persistence['props'][SESSION_ID] || [0, null]
        let windowId = this.getWindowId()

        if (shouldRefreshIfExpired && Math.abs(timestamp - lastTimestamp) > SESSION_CHANGE_THRESHOLD) {
            sessionId = _.UUID()
            windowId = _.UUID()
        } else if (!windowId) {
            windowId = _.UUID()
        }

        this.persistence.register({ [SESSION_ID]: [timestamp, sessionId] })
        this.setWindowId(windowId)

        return {
            sessionId: sessionId,
            windowId: windowId,
        }
    }
}

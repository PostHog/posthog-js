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

    _getWindowId() {
        if (this.windowId) {
            return this.windowId
        }
        return sessionStore.parse(this.window_id_storage_key)
    }

    _setWindowId(windowId) {
        if (windowId !== this.windowId) {
            this.windowId = windowId
            sessionStore.set(this.window_id_storage_key, windowId)
        }
    }

    getSessionAndWindowId(timestamp = null, canTriggerIDRefresh = true) {
        if (timestamp === null) {
            timestamp = new Date()
        }
        let [lastTimestamp, sessionId] = this.persistence['props'][SESSION_ID] || [0, null]
        let windowId = this._getWindowId()

        if (!sessionId || (canTriggerIDRefresh && Math.abs(timestamp - lastTimestamp) > SESSION_CHANGE_THRESHOLD)) {
            sessionId = _.UUID()
            windowId = _.UUID()
        } else if (!windowId) {
            windowId = _.UUID()
        }

        let updatedTimestamp = timestamp
        if (!canTriggerIDRefresh && lastTimestamp !== 0) {
            updatedTimestamp = lastTimestamp
        }

        this.persistence.register({ [SESSION_ID]: [updatedTimestamp, sessionId] })
        this._setWindowId(windowId)

        return {
            sessionId: sessionId,
            windowId: windowId,
        }
    }
}

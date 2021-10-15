import { SESSION_ID } from '../posthog-persistence'
import { _ } from '../utils'

const SESSION_CHANGE_THRESHOLD = 30 * 60 * 1000 // 30 mins

export default (persistence, timestamp) => {
    let [lastTimestamp, sessionId] = persistence['props'][SESSION_ID] || [0, null]
    let isNewSessionId = false

    if (Math.abs(timestamp - lastTimestamp) > SESSION_CHANGE_THRESHOLD) {
        sessionId = _.UUID()
        isNewSessionId = true
    }

    persistence.register({ [SESSION_ID]: [timestamp, sessionId] })
    return {
        isNewSessionId: isNewSessionId,
        sessionId: sessionId,
    }
}

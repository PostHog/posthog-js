import { SESSION_ID } from '../posthog-persistence'
import { nanoid } from 'nanoid'

const SESSION_CHANGE_TIMEOUT = 30 * 60 * 1000 // 30 mins

export default (persistence, timestamp) => {
    let [lastTimestamp, sessionId] = persistence['props'][SESSION_ID] || [0, null]

    if (Math.abs(timestamp - lastTimestamp) > SESSION_CHANGE_TIMEOUT) {
        sessionId = nanoid()
    }

    persistence.register({ [SESSION_ID]: [timestamp, sessionId] })
    return sessionId
}

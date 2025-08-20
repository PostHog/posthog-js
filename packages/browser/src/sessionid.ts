import { PostHogPersistence } from './posthog-persistence'
import { SESSION_ID } from './constants'
import { sessionStore } from './storage'
import { PostHogConfig, SessionIdChangedCallback } from './types'
import { uuid7ToTimestampMs, uuidv7 } from './uuidv7'
import { window } from './utils/globals'

import { createLogger } from './utils/logger'

import { isArray, isNumber, isUndefined, clampToRange } from '@posthog/core'
import { PostHog } from './posthog-core'
import { addEventListener } from './utils'

const logger = createLogger('[SessionId]')

export const DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS = 30 * 60 // 30 minutes
export const MAX_SESSION_IDLE_TIMEOUT_SECONDS = 10 * 60 * 60 // 10 hours
const MIN_SESSION_IDLE_TIMEOUT_SECONDS = 60 // 1 minute
const SESSION_LENGTH_LIMIT_MILLISECONDS = 24 * 3600 * 1000 // 24 hours

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
    private _sessionIdChangedHandlers: SessionIdChangedCallback[] = []
    private readonly _sessionTimeoutMs: number

    // we track activity so we can end the session proactively when it has passed the idle timeout
    private _enforceIdleTimeout: ReturnType<typeof setTimeout> | undefined

    constructor(instance: PostHog, sessionIdGenerator?: () => string, windowIdGenerator?: () => string) {
        if (!instance.persistence) {
            throw new Error('SessionIdManager requires a PostHogPersistence instance')
        }
        if (instance.config.cookieless_mode === 'always') {
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

            this._persistence.register({
                [SESSION_ID]: [sessionActivityTimestamp, sessionId, sessionStartTimestamp],
            })
        }
    }

    private _getSessionId(): [number, string, number] {
        if (this._sessionId && this._sessionActivityTimestamp && this._sessionStartTimestamp) {
            return [this._sessionActivityTimestamp, this._sessionId, this._sessionStartTimestamp]
        }
        const sessionIdInfo = this._persistence.props[SESSION_ID]

        if (isArray(sessionIdInfo) && sessionIdInfo.length === 2) {
            // Storage does not yet have a session start time. Add the last activity timestamp as the start time
            sessionIdInfo.push(sessionIdInfo[0])
        }

        return sessionIdInfo || [0, null, 0]
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
        addEventListener(
            window,
            'beforeunload',
            () => {
                if (this._canUseSessionStorage()) {
                    sessionStore._remove(this._primary_window_exists_storage_key)
                }
            },
            // Not making it passive to try and force the browser to handle this before the page is unloaded
            { capture: false }
        )
    }

    private _sessionHasBeenIdleTooLong = (timestamp: number, lastActivityTimestamp: number) => {
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
        if (this._config.cookieless_mode === 'always') {
            throw new Error('checkAndGetSessionAndWindowId should not be called with cookieless_mode="always"')
        }
        const timestamp = _timestamp || new Date().getTime()

        // eslint-disable-next-line prefer-const
        let [lastActivityTimestamp, sessionId, startTimestamp] = this._getSessionId()
        let windowId = this._getWindowId()

        const sessionPastMaximumLength =
            isNumber(startTimestamp) &&
            startTimestamp > 0 &&
            Math.abs(timestamp - startTimestamp) > SESSION_LENGTH_LIMIT_MILLISECONDS

        let valuesChanged = false
        const noSessionId = !sessionId
        const activityTimeout = !readOnly && this._sessionHasBeenIdleTooLong(timestamp, lastActivityTimestamp)
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
        } else if (!windowId) {
            windowId = this._windowIdGenerator()
            valuesChanged = true
        }

        const newActivityTimestamp =
            lastActivityTimestamp === 0 || !readOnly || sessionPastMaximumLength ? timestamp : lastActivityTimestamp
        const sessionStartTimestamp = startTimestamp === 0 ? new Date().getTime() : startTimestamp

        this._setWindowId(windowId)
        this._setSessionId(sessionId, newActivityTimestamp, sessionStartTimestamp)

        if (!readOnly) {
            this._resetIdleTimer()
        }

        if (valuesChanged) {
            this._sessionIdChangedHandlers.forEach((handler) =>
                handler(
                    sessionId,
                    windowId,
                    valuesChanged ? { noSessionId, activityTimeout, sessionPastMaximumLength } : undefined
                )
            )
        }

        return {
            sessionId,
            windowId,
            sessionStartTimestamp,
            changeReason: valuesChanged ? { noSessionId, activityTimeout, sessionPastMaximumLength } : undefined,
            lastActivityTimestamp: lastActivityTimestamp,
        }
    }

    private _resetIdleTimer() {
        clearTimeout(this._enforceIdleTimeout)
        this._enforceIdleTimeout = setTimeout(() => {
            // enforce idle timeout a little after the session timeout to ensure the session is reset even without activity
            // we need to check session activity first in case a different window has kept the session active
            // while this window has been idle - and the timer has not progressed - e.g. window memory frozen while hidden
            const [lastActivityTimestamp] = this._getSessionId()
            if (this._sessionHasBeenIdleTooLong(new Date().getTime(), lastActivityTimestamp)) {
                this.resetSessionId()
            }
        }, this.sessionTimeoutMs * 1.1)
    }
}

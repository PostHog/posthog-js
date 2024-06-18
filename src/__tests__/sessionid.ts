import { SessionIdManager } from '../sessionid'
import { SESSION_ID } from '../constants'
import { sessionStore } from '../storage'
import { uuidv7, uuid7ToTimestampMs } from '../uuidv7'
import { BootstrapConfig, PostHogConfig, Properties } from '../types'
import { PostHogPersistence } from '../posthog-persistence'
import { assignableWindow } from '../utils/globals'

jest.mock('../uuidv7')
jest.mock('../storage')

describe('Session ID manager', () => {
    let timestamp: number | undefined
    let now: number
    let timestampOfSessionStart: number
    const config: Partial<PostHogConfig> = {
        persistence_name: 'persistance-name',
    }

    let persistence: { props: Properties } & Partial<PostHogPersistence>

    const subject = (sessionIdManager: SessionIdManager, isReadOnly?: boolean) =>
        sessionIdManager.checkAndGetSessionAndWindowId(isReadOnly, timestamp)
    const sessionIdMgr = (phPersistence: Partial<PostHogPersistence>) =>
        new SessionIdManager(config, phPersistence as PostHogPersistence)

    const originalDate = Date

    beforeEach(() => {
        timestamp = 1603107479471
        now = timestamp + 1000

        persistence = {
            props: { [SESSION_ID]: undefined },
            register: jest.fn(),
            disabled: false,
        }
        ;(sessionStore.is_supported as jest.Mock).mockReturnValue(true)
        jest.spyOn(global, 'Date').mockImplementation(() => new originalDate(now))
        ;(uuidv7 as jest.Mock).mockReturnValue('newUUID')
        ;(uuid7ToTimestampMs as jest.Mock).mockReturnValue(timestamp)
    })

    describe('new session id manager', () => {
        it('generates an initial session id and window id, and saves them', () => {
            expect(subject(sessionIdMgr(persistence))).toMatchObject({
                windowId: 'newUUID',
                sessionId: 'newUUID',
                sessionStartTimestamp: timestamp,
            })
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [timestamp, 'newUUID', timestamp],
            })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates an initial session id and window id, and saves them even if readOnly is true', () => {
            expect(subject(sessionIdMgr(persistence), true)).toMatchObject({
                windowId: 'newUUID',
                sessionId: 'newUUID',
                sessionStartTimestamp: timestamp,
            })
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [timestamp, 'newUUID', timestamp],
            })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('should allow bootstrapping of the session id', () => {
            // arrange
            const bootstrapSessionId = 'bootstrap-session-id'
            const bootstrap: BootstrapConfig = {
                sessionID: bootstrapSessionId,
            }
            const sessionIdManager = new SessionIdManager({ ...config, bootstrap }, persistence as PostHogPersistence)

            // act
            const { sessionId, sessionStartTimestamp } = sessionIdManager.checkAndGetSessionAndWindowId(false, now)

            // assert
            expect(sessionId).toEqual(bootstrapSessionId)
            expect(sessionStartTimestamp).toEqual(timestamp)
        })
    })

    describe('stored session data', () => {
        beforeEach(() => {
            ;(sessionStore.parse as jest.Mock).mockReturnValue('oldWindowID')
            timestampOfSessionStart = now - 3600
            persistence.props[SESSION_ID] = [now, 'oldSessionID', timestampOfSessionStart]
        })

        it('reuses old ids and updates the session timestamp if not much time has passed', () => {
            expect(subject(sessionIdMgr(persistence))).toEqual({
                windowId: 'oldWindowID',
                sessionId: 'oldSessionID',
                sessionStartTimestamp: timestampOfSessionStart,
            })
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [timestamp, 'oldSessionID', timestampOfSessionStart],
            })
        })

        it('reuses old ids and does not update the session timestamp if  > 30m pass and readOnly is true', () => {
            const thirtyMinutesAndOneSecond = 60 * 60 * 30 + 1
            const oldTimestamp = now - thirtyMinutesAndOneSecond
            const sessionStart = oldTimestamp - 1000

            persistence.props[SESSION_ID] = [oldTimestamp, 'oldSessionID', sessionStart]

            expect(subject(sessionIdMgr(persistence), true)).toEqual({
                windowId: 'oldWindowID',
                sessionId: 'oldSessionID',
                sessionStartTimestamp: sessionStart,
            })
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [oldTimestamp, 'oldSessionID', sessionStart],
            })
        })

        it('generates only a new window id, and saves it when there is no previous window id set', () => {
            ;(sessionStore.parse as jest.Mock).mockReturnValue(null)
            expect(subject(sessionIdMgr(persistence))).toEqual({
                windowId: 'newUUID',
                sessionId: 'oldSessionID',
                sessionStartTimestamp: timestampOfSessionStart,
            })
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [timestamp, 'oldSessionID', timestampOfSessionStart],
            })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates a new session id and window id, and saves it when >30m since last event', () => {
            const oldTimestamp = 1602107460000
            persistence.props[SESSION_ID] = [oldTimestamp, 'oldSessionID', timestampOfSessionStart]

            expect(subject(sessionIdMgr(persistence))).toEqual({
                windowId: 'newUUID',
                sessionId: 'newUUID',
                sessionStartTimestamp: timestamp,
            })
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [timestamp, 'newUUID', timestamp],
            })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates a new session id and window id, and saves it when >24 hours since start timestamp', () => {
            const oldTimestamp = 1602107460000
            const twentyFourHours = 3600 * 24
            persistence.props[SESSION_ID] = [oldTimestamp, 'oldSessionID', timestampOfSessionStart]
            timestamp = timestampOfSessionStart + twentyFourHours

            expect(subject(sessionIdMgr(persistence))).toEqual({
                windowId: 'newUUID',
                sessionId: 'newUUID',
                sessionStartTimestamp: timestamp,
            })

            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [timestamp, 'newUUID', timestamp],
            })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates a new session id and window id, and saves it when >24 hours since start timestamp even when readonly is true', () => {
            const oldTimestamp = 1602107460000
            const twentyFourHoursAndOneSecond = (3600 * 24 + 1) * 1000
            persistence.props[SESSION_ID] = [oldTimestamp, 'oldSessionID', timestampOfSessionStart]
            timestamp = timestampOfSessionStart + twentyFourHoursAndOneSecond
            now = timestamp + 1000

            expect(subject(sessionIdMgr(persistence), true)).toEqual({
                windowId: 'newUUID',
                sessionId: 'newUUID',
                sessionStartTimestamp: timestamp,
            })

            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [timestamp, 'newUUID', timestamp],
            })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('uses the current time if no timestamp is provided', () => {
            const now = new Date().getTime()
            const oldTimestamp = 1601107460000
            persistence.props[SESSION_ID] = [oldTimestamp, 'oldSessionID', timestampOfSessionStart]
            timestamp = undefined
            expect(subject(sessionIdMgr(persistence))).toEqual({
                windowId: 'newUUID',
                sessionId: 'newUUID',
                sessionStartTimestamp: now,
            })
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [now, 'newUUID', now],
            })
        })

        it('populates the session start timestamp for a browser with no start time stored', () => {
            persistence.props[SESSION_ID] = [timestamp, 'oldSessionID']
            expect(subject(sessionIdMgr(persistence))).toEqual({
                windowId: 'oldWindowID',
                sessionId: 'oldSessionID',
                sessionStartTimestamp: timestamp,
            })
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [timestamp, 'oldSessionID', timestamp],
            })
        })
    })

    describe('window id storage', () => {
        it('stores and retrieves a window_id', () => {
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setWindowId']('newWindowId')
            expect(sessionIdManager['_getWindowId']()).toEqual('newWindowId')
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newWindowId')
        })
        it('stores and retrieves a window_id if persistance is disabled and storage is not used', () => {
            persistence.disabled = true
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setWindowId']('newWindowId')
            expect(sessionIdManager['_getWindowId']()).toEqual('newWindowId')
            expect(sessionStore.set).not.toHaveBeenCalled()
        })
        it('stores and retrieves a window_id if sessionStorage is not supported', () => {
            ;(sessionStore.is_supported as jest.Mock).mockReturnValue(false)
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setWindowId']('newWindowId')
            expect(sessionIdManager['_getWindowId']()).toEqual('newWindowId')
            expect(sessionStore.set).not.toHaveBeenCalled()
        })
    })

    describe('session id storage', () => {
        it('stores and retrieves a session id and timestamp', () => {
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('newSessionId', 1603107460000, 1603107460000)
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [1603107460000, 'newSessionId', 1603107460000],
            })
            expect(sessionIdManager['_getSessionId']()).toEqual([1603107460000, 'newSessionId', 1603107460000])
        })
    })

    describe('reset session id', () => {
        it('clears the existing session id', () => {
            sessionIdMgr(persistence).resetSessionId()
            expect(persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [null, null, null] })
        })
        it('a new session id is generated when called', () => {
            persistence.props[SESSION_ID] = [null, null, null]
            expect(sessionIdMgr(persistence)['_getSessionId']()).toEqual([null, null, null])
            expect(subject(sessionIdMgr(persistence))).toMatchObject({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })
        })
    })

    describe('primary_window_exists_storage_key', () => {
        it('if primary_window_exists key does not exist, do not cycle window id', () => {
            // setup
            ;(sessionStore.parse as jest.Mock).mockImplementation((storeKey: string) =>
                storeKey === 'ph_persistance-name_primary_window_exists' ? undefined : 'oldWindowId'
            )
            // expect
            expect(sessionIdMgr(persistence)['_windowId']).toEqual('oldWindowId')
            expect(sessionStore.remove).toHaveBeenCalledTimes(0)
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_primary_window_exists', true)
        })
        it('if primary_window_exists key exists, cycle window id', () => {
            // setup
            ;(sessionStore.parse as jest.Mock).mockImplementation((storeKey: string) =>
                storeKey === 'ph_persistance-name__primary_window_exists' ? true : 'oldWindowId'
            )
            // expect
            expect(sessionIdMgr(persistence)['_windowId']).toEqual(undefined)
            expect(sessionStore.remove).toHaveBeenCalledWith('ph_persistance-name_window_id')
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_primary_window_exists', true)
        })
    })

    describe('custom session_idle_timeout_seconds', () => {
        const mockSessionManager = (timeout: number | undefined) =>
            new SessionIdManager(
                {
                    session_idle_timeout_seconds: timeout,
                },
                persistence as PostHogPersistence
            )

        beforeEach(() => {
            console.warn = jest.fn()
        })

        it('uses the custom session_idle_timeout_seconds if within bounds', () => {
            assignableWindow.POSTHOG_DEBUG = true
            expect(mockSessionManager(61)['_sessionTimeoutMs']).toEqual(61 * 1000)
            expect(console.warn).toBeCalledTimes(0)
            expect(mockSessionManager(59)['_sessionTimeoutMs']).toEqual(60 * 1000)
            expect(console.warn).toBeCalledTimes(1)
            expect(mockSessionManager(30 * 60 - 1)['_sessionTimeoutMs']).toEqual((30 * 60 - 1) * 1000)
            expect(console.warn).toBeCalledTimes(1)
            expect(mockSessionManager(30 * 60 + 1)['_sessionTimeoutMs']).toEqual(30 * 60 * 1000)
            expect(console.warn).toBeCalledTimes(2)
            // @ts-expect-error - test invalid input
            expect(mockSessionManager('foobar')['_sessionTimeoutMs']).toEqual(30 * 60 * 1000)
            expect(console.warn).toBeCalledTimes(3)
        })
    })
})

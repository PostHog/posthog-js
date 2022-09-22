import { SessionIdManager } from '../sessionid'
import { SESSION_ID } from '../posthog-persistence'
import { sessionStore } from '../storage'
import { _UUID } from '../utils'

jest.mock('../utils')
jest.mock('../storage')

describe('Session ID manager', () => {
    given('subject', () => given.sessionIdManager.checkAndGetSessionAndWindowId(given.readOnly, given.timestamp))
    given('sessionIdManager', () => new SessionIdManager(given.config, given.persistence))

    given('persistence', () => ({
        props: { [SESSION_ID]: given.storedSessionIdData },
        register: jest.fn(),
        disabled: given.disablePersistence,
    }))
    given('disablePersistence', () => false)

    given('config', () => ({
        persistence_name: 'persistance-name',
    }))

    given('timestamp', () => 1603107479471)

    given('now', () => given.timestamp + 1000)

    beforeEach(() => {
        _UUID.mockReturnValue('newUUID')
        sessionStore.is_supported.mockReturnValue(true)
        const mockDate = new Date(given.now)
        jest.spyOn(global, 'Date').mockImplementation(() => mockDate)
    })

    describe('new session id manager', () => {
        it('generates an initial session id and window id, and saves them', () => {
            expect(given.subject).toMatchObject({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [given.timestamp, 'newUUID', given.timestamp],
            })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates an initial session id and window id, and saves them even if readOnly is true', () => {
            given('readOnly', () => true)
            expect(given.subject).toMatchObject({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [given.timestamp, 'newUUID', given.timestamp],
            })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })
    })

    describe('stored session data', () => {
        given('timestampOfSessionStart', () => given.now - 3600)

        given('storedSessionIdData', () => [given.now, 'oldSessionID', given.timestampOfSessionStart])
        beforeEach(() => {
            sessionStore.parse.mockReturnValue('oldWindowID')
        })

        it('reuses old ids and updates the session timestamp if not much time has passed', () => {
            expect(given.subject).toEqual({
                windowId: 'oldWindowID',
                sessionId: 'oldSessionID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [given.timestamp, 'oldSessionID', given.timestampOfSessionStart],
            })
        })

        it('reuses old ids and does not update the session timestamp if  > 30m pass and readOnly is true', () => {
            let thirtyMinutesAndOneSecond = 60 * 60 * 30 + 1
            const oldTimestamp = given.now - thirtyMinutesAndOneSecond
            const sessionStart = oldTimestamp - 1000

            given('storedSessionIdData', () => [oldTimestamp, 'oldSessionID', sessionStart])
            given('readOnly', () => true)

            expect(given.subject).toEqual({
                windowId: 'oldWindowID',
                sessionId: 'oldSessionID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [oldTimestamp, 'oldSessionID', sessionStart],
            })
        })

        it('generates only a new window id, and saves it when there is no previous window id set', () => {
            sessionStore.parse.mockReturnValue(null)
            expect(given.subject).toEqual({
                windowId: 'newUUID',
                sessionId: 'oldSessionID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [given.timestamp, 'oldSessionID', given.timestampOfSessionStart],
            })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates a new session id and window id, and saves it when >30m since last event', () => {
            const oldTimestamp = 1602107460000
            given('storedSessionIdData', () => [oldTimestamp, 'oldSessionID', given.timestampOfSessionStart])

            expect(given.subject).toEqual({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [given.timestamp, 'newUUID', given.timestamp],
            })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates a new session id and window id, and saves it when >24 hours since start timestamp', () => {
            const oldTimestamp = 1602107460000
            const twentyFourHours = 3600 * 24
            given('storedSessionIdData', () => [oldTimestamp, 'oldSessionID', given.timestampOfSessionStart])
            given('timestamp', () => given.timestampOfSessionStart + twentyFourHours)

            expect(given.subject).toEqual({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })

            expect(given.persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [given.timestamp, 'newUUID', given.timestamp],
            })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates a new session id and window id, and saves it when >24 hours since start timestamp even when readonly is true', () => {
            const oldTimestamp = 1602107460000
            const twentyFourHoursAndOneSecond = (3600 * 24 + 1) * 1000
            given('storedSessionIdData', () => [oldTimestamp, 'oldSessionID', given.timestampOfSessionStart])
            given('timestamp', () => given.timestampOfSessionStart + twentyFourHoursAndOneSecond)
            given('readOnly', () => true)

            expect(given.subject).toEqual({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })

            expect(given.persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [given.timestamp, 'newUUID', given.timestamp],
            })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('uses the current time if no timestamp is provided', () => {
            const oldTimestamp = 1601107460000
            given('storedSessionIdData', () => [oldTimestamp, 'oldSessionID', given.timestampOfSessionStart])
            given('timestamp', () => undefined)
            expect(given.subject).toEqual({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [given.now, 'newUUID', given.now],
            })
        })

        it('populates the session start timestamp for a browser with no start time stored', () => {
            given('storedSessionIdData', () => [given.timestamp, 'oldSessionID'])
            expect(given.subject).toEqual({
                windowId: 'oldWindowID',
                sessionId: 'oldSessionID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [given.timestamp, 'oldSessionID', given.timestamp],
            })
        })
    })

    describe('window id storage', () => {
        it('stores and retrieves a window_id', () => {
            given.sessionIdManager._setWindowId('newWindowId')
            expect(given.sessionIdManager._getWindowId()).toEqual('newWindowId')
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newWindowId')
        })
        it('stores and retrieves a window_id if persistance is disabled and storage is not used', () => {
            given('disablePersistence', () => true)
            given.sessionIdManager._setWindowId('newWindowId')
            expect(given.sessionIdManager._getWindowId()).toEqual('newWindowId')
            expect(sessionStore.set).not.toHaveBeenCalled()
        })
        it('stores and retrieves a window_id if sessionStorage is not supported', () => {
            sessionStore.is_supported.mockReturnValue(false)
            given.sessionIdManager._setWindowId('newWindowId')
            expect(given.sessionIdManager._getWindowId()).toEqual('newWindowId')
            expect(sessionStore.set).not.toHaveBeenCalled()
        })
    })

    describe('session id storage', () => {
        it('stores and retrieves a session id and timestamp', () => {
            given.sessionIdManager._setSessionId('newSessionId', 1603107460000, 1603107460000)
            expect(given.persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [1603107460000, 'newSessionId', 1603107460000],
            })
            expect(given.sessionIdManager._getSessionId()).toEqual([1603107460000, 'newSessionId', 1603107460000])
        })
    })

    describe('reset session id', () => {
        it('clears the existing session id', () => {
            given.sessionIdManager.resetSessionId()
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [null, null, null] })
        })
        it('a new session id is generated when called', () => {
            given('storedSessionIdData', () => [null, null, null])
            expect(given.sessionIdManager._getSessionId()).toEqual([null, null, null])
            expect(given.subject).toMatchObject({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })
        })
    })

    describe('primary_window_exists_storage_key', () => {
        it('if primary_window_exists key does not exist, do not cycle window id', () => {
            // setup
            sessionStore.parse.mockImplementation((storeKey) =>
                storeKey === 'ph_persistance-name_primary_window_exists' ? undefined : 'oldWindowId'
            )
            // expect
            expect(given.sessionIdManager._windowId).toEqual('oldWindowId')
            expect(sessionStore.remove).toHaveBeenCalledTimes(0)
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_primary_window_exists', true)
        })
        it('if primary_window_exists key exists, cycle window id', () => {
            // setup
            sessionStore.parse.mockImplementation((storeKey) =>
                storeKey === 'ph_persistance-name__primary_window_exists' ? true : 'oldWindowId'
            )
            // expect
            expect(given.sessionIdManager._windowId).toEqual(undefined)
            expect(sessionStore.remove).toHaveBeenCalledWith('ph_persistance-name_window_id')
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_primary_window_exists', true)
        })
    })
})

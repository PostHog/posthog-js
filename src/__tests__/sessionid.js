import { SessionIdManager } from '../sessionid'
import { SESSION_ID } from '../posthog-persistence'
import { _ } from '../utils'
import { sessionStore } from '../storage'

jest.mock('../utils')
jest.mock('../storage')

describe('Session ID generation', () => {
    given('persistence', () => ({
        props: { [SESSION_ID]: given.storedSessionIdData },
        register: jest.fn(),
    }))

    given('config', () => ({
        persistence_name: 'persistance-name',
    }))

    given('sessionIdManager', () => new SessionIdManager(given.config, given.persistence))

    given('timestamp', () => 1603107479471)

    given('subject', () => given.sessionIdManager.getSessionAndWindowId(given.timestamp))

    beforeEach(() => {
        _.UUID.mockReturnValue('newUUID')
    })

    describe('new session id manager', () => {
        it('generates an initial session id and window id, and saves them', () => {
            expect(given.subject).toMatchObject({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [given.timestamp, 'newUUID'] })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates an initial session id and window id, and saves them even if canTriggerIDRefresh is false', () => {
            given('subject', () => given.sessionIdManager.getSessionAndWindowId(given.timestamp, false))

            expect(given.subject).toMatchObject({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [given.timestamp, 'newUUID'] })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })
    })

    describe('stored session data', () => {
        it('reuses old ids and updates the session timestamp if not much time has passed', () => {
            given('storedSessionIdData', () => [1603107460000, 'oldSessionID'])
            sessionStore.parse.mockReturnValue('oldWindowID')

            expect(given.subject).toEqual({
                windowId: 'oldWindowID',
                sessionId: 'oldSessionID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [given.timestamp, 'oldSessionID'] })
        })

        it('reuses old ids and does not update the session timestamp if  > 30m pass and canTriggerIDRefresh is false', () => {
            const old_timestamp = 1602107460000
            given('storedSessionIdData', () => [old_timestamp, 'oldSessionID'])
            sessionStore.parse.mockReturnValue('oldWindowID')
            given('subject', () => given.sessionIdManager.getSessionAndWindowId(given.timestamp, false))

            expect(given.subject).toEqual({
                windowId: 'oldWindowID',
                sessionId: 'oldSessionID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [old_timestamp, 'oldSessionID'] })
        })

        it('generates only a new window id, and saves it when there is no previous window id set', () => {
            given('storedSessionIdData', () => [1603107460000, 'oldSessionID'])
            sessionStore.parse.mockReturnValue(null)

            expect(given.subject).toEqual({
                windowId: 'newUUID',
                sessionId: 'oldSessionID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [given.timestamp, 'oldSessionID'] })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates a new session id and window id, and saves it when >30m since last event', () => {
            given('storedSessionIdData', () => [1603007460000, 'oldSessionID'])
            sessionStore.parse.mockReturnValue('oldWindowID')

            expect(given.subject).toEqual({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [given.timestamp, 'newUUID'] })
            expect(sessionStore.set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })
    })
})

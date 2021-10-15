import sessionIdGenerator from '../../extensions/sessionid'
import { SESSION_ID } from '../../posthog-persistence'
import { _ } from '../../utils'

jest.mock('../../utils')

describe('Session ID generation', () => {
    given('subject', () => sessionIdGenerator(given.persistence, given.timestamp))

    given('timestamp', () => 1603107479471)

    given('persistence', () => ({
        props: { [SESSION_ID]: given.recordedData },
        register: jest.fn(),
    }))

    beforeEach(() => {
        _.UUID.mockReturnValue('newSessionId')
    })

    describe('no stored session data', () => {
        it('generates a new session id, saves it', () => {
            expect(given.subject).toMatchObject({
                isNewSessionId: true,
                sessionId: 'newSessionId',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [given.timestamp, 'newSessionId'] })
        })
    })

    describe('stored session data', () => {
        it('reuses old session data', () => {
            given('recordedData', () => [1603107460000, 'oldSessionId'])

            expect(given.subject).toEqual({
                isNewSessionId: false,
                sessionId: 'oldSessionId',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [given.timestamp, 'oldSessionId'] })
        })

        it('generates a new session id, saves it when too long since last event', () => {
            given('recordedData', () => [1603007460000, 'oldSessionId'])

            expect(given.subject).toEqual({
                isNewSessionId: true,
                sessionId: 'newSessionId',
            })
            expect(given.persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [given.timestamp, 'newSessionId'] })
        })
    })
})

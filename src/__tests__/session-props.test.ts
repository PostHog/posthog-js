import { SessionPropsManager, StoredSessionSourceProps } from '../session-props'
import { SessionIdManager } from '../sessionid'
import { PostHogPersistence } from '../posthog-persistence'

describe('Session Props Manager', () => {
    const createSessionPropsManager = () => {
        const onSessionId = jest.fn()
        const generateProps = jest.fn()
        const persistenceRegister = jest.fn()
        const sessionIdManager = {
            onSessionId,
        } as unknown as SessionIdManager
        const persistence = {
            register: persistenceRegister,
            props: {},
        } as unknown as PostHogPersistence
        const sessionPropsManager = new SessionPropsManager(sessionIdManager, persistence, generateProps)

        return {
            onSessionId,
            sessionPropsManager,
            persistence,
            sessionIdManager,
            generateProps,
            persistenceRegister,
        }
    }

    it('should register a callback with the session id manager', () => {
        const { onSessionId } = createSessionPropsManager()
        expect(onSessionId).toHaveBeenCalledTimes(1)
    })

    it('should update persistence with client session props', () => {
        // arrange
        const utmSource = 'some-utm-source'
        const sessionId = 'session-id'
        const { onSessionId, generateProps, persistenceRegister } = createSessionPropsManager()
        generateProps.mockReturnValue({ utm_source: utmSource })
        const callback = onSessionId.mock.calls[0][0]

        // act
        callback(sessionId)

        //assert
        expect(generateProps).toHaveBeenCalledTimes(1)

        expect(persistenceRegister).toBeCalledWith({
            $cl_ses_p: {
                p: {
                    s: 'some-utm-source',
                },
                s: 'session-id',
            } as StoredSessionSourceProps,
        })
    })

    it('should not update client session props when session id stays the same', () => {
        // arrange
        const sessionId1 = 'session-id-1'
        const { onSessionId, persistence, generateProps, persistenceRegister } = createSessionPropsManager()
        persistence.props = {
            $cl_ses_p: {
                p: {},
                s: sessionId1,
            } as StoredSessionSourceProps,
        }
        const callback = onSessionId.mock.calls[0][0]

        // act
        callback(sessionId1)

        //assert
        expect(generateProps).toHaveBeenCalledTimes(0)
        expect(persistenceRegister).toHaveBeenCalledTimes(0)
    })

    it('should update client session props when session id changes', () => {
        // arrange
        const sessionId1 = 'session-id-1'
        const sessionId2 = 'session-id-2'

        const { onSessionId, persistence, generateProps, persistenceRegister } = createSessionPropsManager()
        persistence.props = {
            $cl_ses_p: {
                p: {},
                s: sessionId1,
            } as StoredSessionSourceProps,
        }
        const callback = onSessionId.mock.calls[0][0]

        // act
        callback(sessionId2)

        //assert
        expect(generateProps).toHaveBeenCalledTimes(1)
        expect(persistenceRegister).toHaveBeenCalledTimes(1)
    })

    it('should return client session props', () => {
        // arrange
        const { persistence, sessionPropsManager } = createSessionPropsManager()
        persistence.props = {
            $cl_ses_p: {
                p: {
                    s: 'some-utm-source',
                },
                s: 'session-id',
            } as StoredSessionSourceProps,
        }

        // act
        const properties = sessionPropsManager.getSessionProps()

        //assert
        expect(properties).toEqual({
            $client_session_initial_utm_source: 'some-utm-source',
        })
    })
})

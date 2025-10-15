import { SessionPropsManager } from '../session-props'
import { SessionIdManager } from '../sessionid'
import { PostHogPersistence } from '../posthog-persistence'
import { PostHog } from '../posthog-core'

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
        const posthog = {
            sessionManager: sessionIdManager,
            persistence,
            config: {},
        } as unknown as PostHog

        const sessionPropsManager = new SessionPropsManager(posthog, sessionIdManager, persistence, generateProps)

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
            $client_session_props: {
                props: {
                    utm_source: 'some-utm-source',
                },
                sessionId: 'session-id',
            },
        })
    })

    it('should not update client session props when session id stays the same', () => {
        // arrange
        const sessionId1 = 'session-id-1'
        const { onSessionId, persistence, generateProps, persistenceRegister } = createSessionPropsManager()
        persistence.props = {
            $client_session_props: {
                props: {},
                sessionId: sessionId1,
            },
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
            $client_session_props: {
                props: {},
                sessionId: sessionId1,
            },
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
            $client_session_props: {
                props: {
                    utm_source: 'some-utm-source',
                },
                sessionId: 'session-id',
            },
        }

        // act
        const properties = sessionPropsManager.getSetOnceProps()

        //assert
        expect(properties).toEqual({
            utm_source: 'some-utm-source',
        })
    })

    it('should convert a url and referrer into a full set of props', () => {
        // arrange
        const { persistence, sessionPropsManager } = createSessionPropsManager()
        persistence.props = {
            $client_session_props: {
                props: {
                    r: 'http://referrer.example.com/referrer',
                    u: 'https://app.example.com/page?utm_source=example',
                },
                sessionId: 'session-id',
            },
        }

        // act
        const setOnceProps = sessionPropsManager.getSetOnceProps()
        const sessionProps = sessionPropsManager.getSessionProps()

        //assert
        expect(setOnceProps).toEqual({
            $current_url: 'https://app.example.com/page?utm_source=example',
            $host: 'app.example.com',
            $pathname: '/page',
            $referrer: 'http://referrer.example.com/referrer',
            $referring_domain: 'referrer.example.com',
            _kx: null,
            dclid: null,
            epik: null,
            fbclid: null,
            gad_source: null,
            gbraid: null,
            gclid: null,
            gclsrc: null,
            igshid: null,
            irclid: null,
            li_fat_id: null,
            mc_cid: null,
            msclkid: null,
            qclid: null,
            rdt_cid: null,
            sccid: null,
            ttclid: null,
            twclid: null,
            utm_campaign: null,
            utm_content: null,
            utm_medium: null,
            utm_source: 'example',
            utm_term: null,
            wbraid: null,
        })
        expect(sessionProps).toEqual({
            $session_entry_referring_domain: 'referrer.example.com',
            $session_entry_referrer: 'http://referrer.example.com/referrer',
            $session_entry_url: 'https://app.example.com/page?utm_source=example',
            $session_entry_host: 'app.example.com',
            $session_entry_pathname: '/page',
            $session_entry_utm_source: 'example',
        })
    })

    it('should use bootstrapped session props when provided', () => {
        // arrange
        const bootstrappedProps = {
            $session_entry_utm_source: 'facebook',
            $session_entry_utm_campaign: 'winter_sale',
            $session_entry_utm_medium: 'social',
        }

        const onSessionId = jest.fn()
        const generateProps = jest.fn()
        const persistenceRegister = jest.fn()
        const sessionIdManager = {
            onSessionId,
        } as unknown as SessionIdManager
        const persistence = {
            register: persistenceRegister,
            props: {
                $client_session_props: {
                    props: {},
                    sessionId: 'bootstrap-session',
                },
            },
        } as unknown as PostHogPersistence
        const posthog = {
            sessionManager: sessionIdManager,
            persistence,
            config: {
                bootstrap: {
                    sessionProps: bootstrappedProps,
                    sessionID: 'bootstrap-session',
                },
            },
        } as unknown as PostHog

        const sessionPropsManager = new SessionPropsManager(posthog, sessionIdManager, persistence, generateProps)

        // act
        const sessionProps = sessionPropsManager.getSessionProps()

        // assert
        expect(sessionProps).toEqual(bootstrappedProps)
        expect(generateProps).not.toHaveBeenCalled()
    })

    it('should clear bootstrapped session props when session changes', () => {
        // arrange
        const bootstrappedProps = {
            $session_entry_utm_source: 'facebook',
            $session_entry_utm_campaign: 'winter_sale',
        }

        const onSessionId = jest.fn()
        const generateProps = jest.fn()
        const persistenceRegister = jest.fn()
        const sessionIdManager = {
            onSessionId,
        } as unknown as SessionIdManager
        const persistence = {
            register: persistenceRegister,
            props: {
                $client_session_props: {
                    props: {},
                    sessionId: 'bootstrap-session',
                },
            },
        } as unknown as PostHogPersistence
        const posthog = {
            sessionManager: sessionIdManager,
            persistence,
            config: {
                bootstrap: {
                    sessionProps: bootstrappedProps,
                    sessionID: 'bootstrap-session',
                },
            },
        } as unknown as PostHog

        const sessionPropsManager = new SessionPropsManager(posthog, sessionIdManager, persistence, generateProps)

        // Initial session should use bootstrapped props
        expect(sessionPropsManager.getSessionProps()).toEqual(bootstrappedProps)

        // Simulate session change
        const callback = onSessionId.mock.calls[0][0]
        persistence.props = {
            $client_session_props: {
                props: {
                    r: 'http://example.com',
                    u: 'https://app.example.com/page?utm_source=google',
                },
                sessionId: 'new-session',
            },
        }
        callback('new-session')

        // After session change, should derive from stored props, not use bootstrapped
        const newSessionProps = sessionPropsManager.getSessionProps()
        expect(newSessionProps).not.toEqual(bootstrappedProps)
        expect(newSessionProps).toHaveProperty('$session_entry_utm_source', 'google')
        expect(newSessionProps).toHaveProperty('$session_entry_referring_domain', 'example.com')
    })

    it('should fall back to derived props when no bootstrapped props provided', () => {
        // arrange
        const onSessionId = jest.fn()
        const generateProps = jest.fn()
        const persistenceRegister = jest.fn()
        const sessionIdManager = {
            onSessionId,
        } as unknown as SessionIdManager
        const persistence = {
            register: persistenceRegister,
            props: {
                $client_session_props: {
                    props: {
                        r: 'http://example.com',
                        u: 'https://app.example.com/page?utm_source=test',
                    },
                    sessionId: 'session-id',
                },
            },
        } as unknown as PostHogPersistence
        const posthog = {
            sessionManager: sessionIdManager,
            persistence,
            config: {
                // No bootstrap config provided
            },
        } as unknown as PostHog

        const sessionPropsManager = new SessionPropsManager(posthog, sessionIdManager, persistence, generateProps)

        // act
        const sessionProps = sessionPropsManager.getSessionProps()

        // assert
        expect(sessionProps).toHaveProperty('$session_entry_utm_source', 'test')
        expect(sessionProps).toHaveProperty('$session_entry_referring_domain', 'example.com')
    })

    it('should use bootstrapped session props without sessionID for initial session only', () => {
        // arrange
        const bootstrappedProps = {
            $session_entry_utm_source: 'twitter',
            $session_entry_utm_campaign: 'launch',
        }

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
        const posthog = {
            sessionManager: sessionIdManager,
            persistence,
            config: {
                bootstrap: {
                    sessionProps: bootstrappedProps,
                    // Note: no sessionID provided
                },
            },
        } as unknown as PostHog

        const sessionPropsManager = new SessionPropsManager(posthog, sessionIdManager, persistence, generateProps)

        // Initial session should use bootstrapped props
        expect(sessionPropsManager.getSessionProps()).toEqual(bootstrappedProps)

        // Simulate first session initialization callback (no stored session yet)
        const callback = onSessionId.mock.calls[0][0]
        callback('first-session')

        // After first session callback, should STILL use bootstrapped props
        expect(sessionPropsManager.getSessionProps()).toEqual(bootstrappedProps)

        // Now simulate an actual session change (stored session exists)
        persistence.props = {
            $client_session_props: {
                props: {
                    r: 'http://example.com',
                    u: 'https://app.example.com/page?utm_source=organic',
                },
                sessionId: 'first-session',
            },
        }
        callback('second-session')

        // After real session change, should derive from stored props
        const newSessionProps = sessionPropsManager.getSessionProps()
        expect(newSessionProps).not.toEqual(bootstrappedProps)
        expect(newSessionProps).toHaveProperty('$session_entry_utm_source', 'organic')
    })

    it('should use bootstrapped session props when returning user has expired session', () => {
        // arrange - User returns after session timeout/expiration
        const bootstrappedProps = {
            $session_entry_utm_source: 'email',
            $session_entry_utm_campaign: 'newsletter',
        }

        const onSessionId = jest.fn()
        const generateProps = jest.fn()
        const persistenceRegister = jest.fn()
        const sessionIdManager = {
            onSessionId,
        } as unknown as SessionIdManager
        const persistence = {
            register: persistenceRegister,
            props: {
                // Old expired session exists in persistence
                $client_session_props: {
                    props: {
                        r: 'http://oldsite.com',
                        u: 'https://app.example.com/old-page?utm_source=google',
                    },
                    sessionId: 'expired-session-from-yesterday',
                },
            },
        } as unknown as PostHogPersistence
        const posthog = {
            sessionManager: sessionIdManager,
            persistence,
            config: {
                bootstrap: {
                    sessionProps: bootstrappedProps,
                    // Note: no sessionID provided
                },
            },
        } as unknown as PostHog

        const sessionPropsManager = new SessionPropsManager(posthog, sessionIdManager, persistence, generateProps)

        // Initial state - should use bootstrapped props
        expect(sessionPropsManager.getSessionProps()).toEqual(bootstrappedProps)

        // Simulate first callback with NEW session ID (old session expired, new one generated)
        const callback = onSessionId.mock.calls[0][0]
        callback('new-session-after-expiration')

        // After first callback, should STILL use bootstrapped props
        // (expired session is treated like fresh start)
        expect(sessionPropsManager.getSessionProps()).toEqual(bootstrappedProps)

        // Update persistence to reflect the new session
        persistence.props = {
            $client_session_props: {
                props: {
                    r: 'http://example.com',
                    u: 'https://app.example.com/page?utm_source=organic',
                },
                sessionId: 'new-session-after-expiration',
            },
        }

        // Now simulate a REAL session change (user continues browsing, session changes)
        callback('another-new-session')

        // After second callback (real session change), should derive from stored props
        const newSessionProps = sessionPropsManager.getSessionProps()
        expect(newSessionProps).not.toEqual(bootstrappedProps)
        expect(newSessionProps).toHaveProperty('$session_entry_utm_source', 'organic')
    })
})

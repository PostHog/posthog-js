import { DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS, MAX_SESSION_IDLE_TIMEOUT_SECONDS, SessionIdManager } from '../sessionid'
import { SESSION_ID } from '../constants'
import { sessionStore } from '../storage'
import { uuid7ToTimestampMs, uuidv7 } from '../uuidv7'
import { BootstrapConfig, PostHogConfig, Properties } from '../types'
import { PostHogPersistence } from '../posthog-persistence'
import { assignableWindow } from '../utils/globals'
import { createMockPostHog } from './helpers/posthog-instance'

jest.mock('../uuidv7')
jest.mock('../storage')

describe('Session ID manager', () => {
    let timestamp: number | undefined
    let now: number
    let timestampOfSessionStart: number
    let registerMock: jest.Mock

    const config: Partial<PostHogConfig> = {
        persistence_name: 'persistance-name',
    }

    let persistence: { props: Properties } & Partial<PostHogPersistence>

    const sessionIdMgr = (phPersistence: Partial<PostHogPersistence>) => {
        registerMock = jest.fn()
        return new SessionIdManager(
            createMockPostHog({
                config,
                persistence: phPersistence as PostHogPersistence,
                register: registerMock,
            })
        )
    }

    const originalDate = Date

    beforeEach(() => {
        timestamp = 1603107479471
        now = timestamp + 1000

        persistence = {
            props: { [SESSION_ID]: undefined },
            register: jest.fn().mockImplementation((props) => {
                // Mock the behavior of register - it should update the props
                Object.assign(persistence.props, props)
            }),
            _disabled: false,
        }
        ;(sessionStore._is_supported as jest.Mock).mockReturnValue(true)
        // @ts-expect-error - TS gets confused about the types here
        jest.spyOn(global, 'Date').mockImplementation(() => new originalDate(now))
        ;(uuidv7 as jest.Mock).mockReturnValue('newUUID')
        ;(uuid7ToTimestampMs as jest.Mock).mockReturnValue(timestamp)
    })

    describe('new session id manager', () => {
        it('generates an initial session id and window id, and saves them', () => {
            expect(sessionIdMgr(persistence).checkAndGetSessionAndWindowId(undefined, timestamp)).toMatchObject({
                windowId: 'newUUID',
                sessionId: 'newUUID',
                sessionStartTimestamp: timestamp,
            })
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [timestamp, 'newUUID', timestamp],
            })
            expect(sessionStore._set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates an initial session id and window id, and saves them even if readOnly is true', () => {
            expect(sessionIdMgr(persistence).checkAndGetSessionAndWindowId(true, timestamp)).toMatchObject({
                windowId: 'newUUID',
                sessionId: 'newUUID',
                sessionStartTimestamp: timestamp,
            })
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [timestamp, 'newUUID', timestamp],
            })
            expect(sessionStore._set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('should allow bootstrapping of the session id', () => {
            // arrange
            const bootstrapSessionId = 'bootstrap-session-id'
            const bootstrap: BootstrapConfig = {
                sessionID: bootstrapSessionId,
            }
            const sessionIdManager = new SessionIdManager(
                createMockPostHog({
                    config: { ...config, bootstrap },
                    persistence: persistence as PostHogPersistence,
                    register: jest.fn(),
                })
            )

            // act
            const { sessionId, sessionStartTimestamp } = sessionIdManager.checkAndGetSessionAndWindowId(false, now)

            // assert
            expect(sessionId).toEqual(bootstrapSessionId)
            expect(sessionStartTimestamp).toEqual(timestamp)
        })

        it('registers the session timeout as an event property', () => {
            config.session_idle_timeout_seconds = 8 * 60 * 60
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager.checkAndGetSessionAndWindowId(undefined, timestamp)
            expect(registerMock).toHaveBeenCalledWith({
                $configured_session_timeout_ms: config.session_idle_timeout_seconds * 1000,
            })
        })
    })

    describe('stored session data', () => {
        beforeEach(() => {
            ;(sessionStore._parse as jest.Mock).mockReturnValue('oldWindowID')
            timestampOfSessionStart = now - 3600
            persistence.props[SESSION_ID] = [now, 'oldSessionID', timestampOfSessionStart]
        })

        it('reuses old ids and updates the session timestamp if not much time has passed', () => {
            expect(sessionIdMgr(persistence).checkAndGetSessionAndWindowId(undefined, timestamp)).toEqual({
                windowId: 'oldWindowID',
                sessionId: 'oldSessionID',
                sessionStartTimestamp: timestampOfSessionStart,
                lastActivityTimestamp: expect.any(Number),
                changeReason: undefined,
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

            expect(sessionIdMgr(persistence).checkAndGetSessionAndWindowId(true, timestamp)).toEqual({
                windowId: 'oldWindowID',
                sessionId: 'oldSessionID',
                sessionStartTimestamp: sessionStart,
                lastActivityTimestamp: oldTimestamp,
            })
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [oldTimestamp, 'oldSessionID', sessionStart],
            })
        })

        it('generates only a new window id, and saves it when there is no previous window id set', () => {
            ;(sessionStore._parse as jest.Mock).mockReturnValue(null)
            expect(sessionIdMgr(persistence).checkAndGetSessionAndWindowId(undefined, timestamp)).toEqual({
                windowId: 'newUUID',
                sessionId: 'oldSessionID',
                sessionStartTimestamp: timestampOfSessionStart,
                lastActivityTimestamp: expect.any(Number),
                changeReason: {
                    activityTimeout: false,
                    noSessionId: false,
                    sessionPastMaximumLength: false,
                },
            })
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [timestamp, 'oldSessionID', timestampOfSessionStart],
            })
            expect(sessionStore._set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates a new session id and window id, and saves it when >30m since last event', () => {
            const oldTimestamp = 1602107460000
            persistence.props[SESSION_ID] = [oldTimestamp, 'oldSessionID', timestampOfSessionStart]

            expect(sessionIdMgr(persistence).checkAndGetSessionAndWindowId(undefined, timestamp)).toEqual({
                windowId: 'newUUID',
                sessionId: 'newUUID',
                sessionStartTimestamp: timestamp,
                lastActivityTimestamp: oldTimestamp,
                changeReason: {
                    activityTimeout: true,
                    noSessionId: false,
                    sessionPastMaximumLength: false,
                },
            })
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [timestamp, 'newUUID', timestamp],
            })
            expect(sessionStore._set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates a new session id and window id, and saves it when >24 hours since start timestamp', () => {
            const oldTimestamp = 1602107460000
            const twentyFourHours = 3600 * 24
            persistence.props[SESSION_ID] = [oldTimestamp, 'oldSessionID', timestampOfSessionStart]
            timestamp = timestampOfSessionStart + twentyFourHours

            expect(sessionIdMgr(persistence).checkAndGetSessionAndWindowId(undefined, timestamp)).toEqual({
                windowId: 'newUUID',
                sessionId: 'newUUID',
                sessionStartTimestamp: timestamp,
                lastActivityTimestamp: oldTimestamp,
                changeReason: {
                    activityTimeout: true,
                    noSessionId: false,
                    sessionPastMaximumLength: false,
                },
            })

            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [timestamp, 'newUUID', timestamp],
            })
            expect(sessionStore._set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('generates a new session id and window id, and saves it when >24 hours since start timestamp even when readonly is true', () => {
            const oldTimestamp = 1602107460000
            const twentyFourHoursAndOneSecond = (3600 * 24 + 1) * 1000
            persistence.props[SESSION_ID] = [oldTimestamp, 'oldSessionID', timestampOfSessionStart]
            timestamp = timestampOfSessionStart + twentyFourHoursAndOneSecond
            now = timestamp + 1000

            expect(sessionIdMgr(persistence).checkAndGetSessionAndWindowId(true, timestamp)).toEqual({
                windowId: 'newUUID',
                sessionId: 'newUUID',
                sessionStartTimestamp: timestamp,
                lastActivityTimestamp: oldTimestamp,
                changeReason: {
                    activityTimeout: false,
                    noSessionId: false,
                    sessionPastMaximumLength: true,
                },
            })

            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [timestamp, 'newUUID', timestamp],
            })
            expect(sessionStore._set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newUUID')
        })

        it('uses the current time if no timestamp is provided', () => {
            const now = new Date().getTime()
            const oldTimestamp = 1601107460000
            persistence.props[SESSION_ID] = [oldTimestamp, 'oldSessionID', timestampOfSessionStart]
            timestamp = undefined
            expect(sessionIdMgr(persistence).checkAndGetSessionAndWindowId(undefined, timestamp)).toEqual({
                windowId: 'newUUID',
                sessionId: 'newUUID',
                sessionStartTimestamp: now,
                lastActivityTimestamp: oldTimestamp,
                changeReason: {
                    activityTimeout: true,
                    noSessionId: false,
                    sessionPastMaximumLength: false,
                },
            })
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [now, 'newUUID', now],
            })
        })

        it('populates the session start timestamp for a browser with no start time stored', () => {
            persistence.props[SESSION_ID] = [timestamp, 'oldSessionID']
            expect(sessionIdMgr(persistence).checkAndGetSessionAndWindowId(undefined, timestamp)).toEqual({
                windowId: 'oldWindowID',
                sessionId: 'oldSessionID',
                sessionStartTimestamp: timestamp,
                lastActivityTimestamp: timestamp,
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
            expect(sessionStore._set).toHaveBeenCalledWith('ph_persistance-name_window_id', 'newWindowId')
        })
        it('stores and retrieves a window_id if persistance is disabled and storage is not used', () => {
            persistence._disabled = true
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setWindowId']('newWindowId')
            expect(sessionIdManager['_getWindowId']()).toEqual('newWindowId')
            expect(sessionStore._set).not.toHaveBeenCalled()
        })
        it('stores and retrieves a window_id if sessionStorage is not supported', () => {
            ;(sessionStore._is_supported as jest.Mock).mockReturnValue(false)
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setWindowId']('newWindowId')
            expect(sessionIdManager['_getWindowId']()).toEqual('newWindowId')
            expect(sessionStore._set).not.toHaveBeenCalled()
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
            expect(sessionIdMgr(persistence).checkAndGetSessionAndWindowId(undefined, timestamp)).toMatchObject({
                windowId: 'newUUID',
                sessionId: 'newUUID',
            })
        })

        it.each([
            { firstCallReadOnly: true, secondCallReadOnly: false },
            { firstCallReadOnly: true, secondCallReadOnly: true },
            { firstCallReadOnly: false, secondCallReadOnly: true },
            { firstCallReadOnly: false, secondCallReadOnly: false },
        ])(
            'does not spuriously trigger activity timeout after reset (first=$firstCallReadOnly, second=$secondCallReadOnly)',
            ({ firstCallReadOnly, secondCallReadOnly }) => {
                const sessionIdManager = sessionIdMgr(persistence)

                sessionIdManager.resetSessionId()

                const firstResult = sessionIdManager.checkAndGetSessionAndWindowId(firstCallReadOnly, timestamp)
                expect(firstResult.changeReason?.noSessionId).toBe(true)
                expect(firstResult.changeReason?.activityTimeout).toBe(false)

                const secondResult = sessionIdManager.checkAndGetSessionAndWindowId(
                    secondCallReadOnly,
                    timestamp! + 100
                )
                expect(secondResult.sessionId).toBe(firstResult.sessionId)
                expect(secondResult.changeReason).toBeUndefined()
            }
        )
    })

    describe('primary_window_exists_storage_key', () => {
        it('if primary_window_exists key does not exist, do not cycle window id', () => {
            // setup
            ;(sessionStore._parse as jest.Mock).mockImplementation((storeKey: string) =>
                storeKey === 'ph_persistance-name_primary_window_exists' ? undefined : 'oldWindowId'
            )
            // expect
            expect(sessionIdMgr(persistence)['_windowId']).toEqual('oldWindowId')
            expect(sessionStore._remove).toHaveBeenCalledTimes(0)
            expect(sessionStore._set).toHaveBeenCalledWith('ph_persistance-name_primary_window_exists', true)
        })
        it('if primary_window_exists key exists, cycle window id', () => {
            // setup
            ;(sessionStore._parse as jest.Mock).mockImplementation((storeKey: string) =>
                storeKey === 'ph_persistance-name_primary_window_exists' ? true : 'oldWindowId'
            )
            // expect
            expect(sessionIdMgr(persistence)['_windowId']).toEqual(undefined)
            expect(sessionStore._remove).toHaveBeenCalledWith('ph_persistance-name_window_id')
            expect(sessionStore._set).toHaveBeenCalledWith('ph_persistance-name_primary_window_exists', true)
        })
    })

    describe('custom session_idle_timeout_seconds', () => {
        const mockSessionManager = (timeout: number | undefined) =>
            new SessionIdManager(
                createMockPostHog({
                    config: {
                        session_idle_timeout_seconds: timeout,
                    },
                    persistence: persistence as PostHogPersistence,
                    register: jest.fn(),
                })
            )

        beforeEach(() => {
            console.warn = jest.fn()
        })

        it('uses the custom session_idle_timeout_seconds if within bounds', () => {
            assignableWindow.POSTHOG_DEBUG = true
            expect(mockSessionManager(61)['_sessionTimeoutMs']).toEqual(61 * 1000)
            expect(console.warn).toHaveBeenCalledTimes(0)
            expect(mockSessionManager(59)['_sessionTimeoutMs']).toEqual(60 * 1000)
            expect(console.warn).toHaveBeenCalledTimes(1)
            expect(mockSessionManager(30 * 60 - 1)['_sessionTimeoutMs']).toEqual((30 * 60 - 1) * 1000)
            expect(console.warn).toHaveBeenCalledTimes(1)
            expect(mockSessionManager(MAX_SESSION_IDLE_TIMEOUT_SECONDS + 1)['_sessionTimeoutMs']).toEqual(
                MAX_SESSION_IDLE_TIMEOUT_SECONDS * 1000
            )
            expect(console.warn).toHaveBeenCalledTimes(2)
            // @ts-expect-error - test invalid input
            expect(mockSessionManager('foobar')['_sessionTimeoutMs']).toEqual(
                DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS * 1000
            )
            expect(console.warn).toHaveBeenCalledTimes(3)
        })
    })

    describe('proactive idle timeout', () => {
        it('starts a timer', () => {
            expect(sessionIdMgr(persistence)['_enforceIdleTimeout']).toBeDefined()
        })

        it('sets a new timer when checking session id', () => {
            const sessionIdManager = sessionIdMgr(persistence)
            const originalTimer = sessionIdManager['_enforceIdleTimeout']
            sessionIdManager.checkAndGetSessionAndWindowId(undefined, timestamp)
            expect(sessionIdManager['_enforceIdleTimeout']).toBeDefined()
            expect(sessionIdManager['_enforceIdleTimeout']).not.toEqual(originalTimer)
        })

        it('does not set a new timer when read only checking session id', () => {
            const sessionIdManager = sessionIdMgr(persistence)
            const originalTimer = sessionIdManager['_enforceIdleTimeout']
            sessionIdManager.checkAndGetSessionAndWindowId(true, timestamp)
            expect(sessionIdManager['_enforceIdleTimeout']).toBeDefined()
            expect(sessionIdManager['_enforceIdleTimeout']).toEqual(originalTimer)
        })

        it('resets session when idle timeout is exceeded', async () => {
            jest.useFakeTimers()

            const sessionIdManager = sessionIdMgr(persistence)
            const resetSpy = jest.spyOn(sessionIdManager, 'resetSessionId')

            // Start with a fresh session
            sessionIdManager.checkAndGetSessionAndWindowId(false, timestamp)

            // Set up persistence to simulate inactivity - session was last active long ago
            const idleTimestamp = timestamp - (sessionIdManager.sessionTimeoutMs + 1000)
            persistence.props[SESSION_ID] = [idleTimestamp, 'oldSessionID', idleTimestamp]

            // Fast-forward time to trigger the idle timeout timer
            const idleTimeoutMs = sessionIdManager.sessionTimeoutMs * 1.1
            jest.advanceTimersByTime(idleTimeoutMs + 1000)

            // Timer should have fired and called resetSessionId
            expect(resetSpy).toHaveBeenCalled()

            // After reset, persistence.register should have been called with null values
            expect(persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [null, null, null] })

            // Next call should generate a new session due to no session ID
            const newSessionData = sessionIdManager.checkAndGetSessionAndWindowId(false)
            expect(newSessionData.sessionId).toBe('newUUID')
            expect(newSessionData.sessionId).not.toEqual('oldSessionID')
            expect(newSessionData.changeReason?.noSessionId).toBe(true)

            jest.useRealTimers()
        })

        it('timer checks current session activity before resetting', async () => {
            jest.useFakeTimers()

            const sessionIdManager = sessionIdMgr(persistence)
            const resetSpy = jest.spyOn(sessionIdManager, 'resetSessionId')

            // Mock _getSessionId to control what the timer sees
            const getSessionIdSpy = jest.spyOn(sessionIdManager as any, '_getSessionId')

            // Start with a fresh session
            sessionIdManager.checkAndGetSessionAndWindowId(false, timestamp)

            // Initially set up an idle session
            const idleTimestamp = timestamp - (sessionIdManager.sessionTimeoutMs + 1000)
            getSessionIdSpy.mockReturnValue([idleTimestamp, 'sharedSessionID', timestamp])

            // Fast-forward time almost to when timer fires
            const idleTimeoutMs = sessionIdManager.sessionTimeoutMs * 1.1
            jest.advanceTimersByTime(idleTimeoutMs - 100)

            // Before timer fires, change mock to return recent activity (simulating another window updating)
            const recentTimestamp = new Date().getTime() - 1000 // 1 second ago
            getSessionIdSpy.mockReturnValue([recentTimestamp, 'sharedSessionID', timestamp])

            // Let the timer fire
            jest.advanceTimersByTime(200)

            // The timer should NOT have reset the session because it found recent activity
            expect(resetSpy).not.toHaveBeenCalled()

            jest.useRealTimers()
        })
    })

    describe('forcedIdleReset event emitter', () => {
        it('is safe when there are no handlers registered', async () => {
            jest.useFakeTimers()

            const sessionIdManager = sessionIdMgr(persistence)

            // Start with a fresh session
            sessionIdManager.checkAndGetSessionAndWindowId(false, timestamp)

            // Set up persistence to simulate inactivity
            const idleTimestamp = timestamp - (sessionIdManager.sessionTimeoutMs + 1000)
            persistence.props[SESSION_ID] = [idleTimestamp, 'oldSessionID', idleTimestamp]

            // Fast-forward time to trigger the idle timeout timer
            // This should not throw even with no handlers registered
            expect(() => {
                const idleTimeoutMs = sessionIdManager.sessionTimeoutMs * 1.1
                jest.advanceTimersByTime(idleTimeoutMs + 1000)
            }).not.toThrow()

            jest.useRealTimers()
        })

        it('calls multiple handlers when forcedIdleReset occurs', async () => {
            jest.useFakeTimers()

            const sessionIdManager = sessionIdMgr(persistence)
            const mockHandler1 = jest.fn()
            const mockHandler2 = jest.fn()
            const mockHandler3 = jest.fn()

            // Register multiple handlers
            sessionIdManager.on('forcedIdleReset', mockHandler1)
            sessionIdManager.on('forcedIdleReset', mockHandler2)
            sessionIdManager.on('forcedIdleReset', mockHandler3)

            // Start with a fresh session
            sessionIdManager.checkAndGetSessionAndWindowId(false, timestamp)

            // Set up persistence to simulate inactivity
            const idleTimestamp = timestamp - (sessionIdManager.sessionTimeoutMs + 1000)
            persistence.props[SESSION_ID] = [idleTimestamp, 'oldSessionID', idleTimestamp]

            // Fast-forward time to trigger the idle timeout timer
            const idleTimeoutMs = sessionIdManager.sessionTimeoutMs * 1.1
            jest.advanceTimersByTime(idleTimeoutMs + 1000)

            // All handlers should have been called exactly once
            expect(mockHandler1).toHaveBeenCalledTimes(1)
            expect(mockHandler2).toHaveBeenCalledTimes(1)
            expect(mockHandler3).toHaveBeenCalledTimes(1)

            jest.useRealTimers()
        })
    })

    describe('persistence is source of truth over in-memory cache', () => {
        // This test verifies that when persistence is updated (e.g., by another tab or after a frozen tab thaws),
        // the session manager reads from persistence rather than trusting stale in-memory cache

        const memoryConfig = {
            persistence_name: 'test-session-memory',
            persistence: 'memory',
            token: 'test-token',
        } as PostHogConfig

        it.each([
            { description: 'with stale timestamp from simulated frozen tab', offsetMs: 1000 },
            { description: 'with exactly expired timestamp', offsetMs: 1 },
        ])('should detect activity timeout $description', ({ offsetMs }) => {
            const realPersistence = new PostHogPersistence(memoryConfig)
            const testTimestamp = 1603107479471

            const sessionIdManager = new SessionIdManager(
                createMockPostHog({
                    config: memoryConfig,
                    persistence: realPersistence,
                    register: jest.fn(),
                }),
                () => 'newUUID',
                () => 'newUUID'
            )

            // First call establishes the session
            const firstResult = sessionIdManager.checkAndGetSessionAndWindowId(false, testTimestamp)
            expect(firstResult.sessionId).toBe('newUUID')

            // Simulate persistence being updated externally to have a stale timestamp
            // In a frozen tab scenario, another tab might have updated persistence,
            // or time passed while the tab was frozen
            const staleTimestamp = testTimestamp - (DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS * 1000 + offsetMs)
            realPersistence.register({ [SESSION_ID]: [staleTimestamp, 'oldSessionID', staleTimestamp] })

            // Second call should read from persistence and detect the activity timeout
            const secondResult = sessionIdManager.checkAndGetSessionAndWindowId(false, testTimestamp)

            // The session SHOULD rotate because persistence shows idle timeout exceeded
            expect(secondResult.changeReason?.activityTimeout).toBe(true)
            expect(secondResult.sessionId).not.toBe('oldSessionID')
        })
    })

    describe('destroy()', () => {
        it('clears the idle timeout timer', () => {
            jest.useFakeTimers()
            const sessionIdManager = sessionIdMgr(persistence)

            // The timer is created in the constructor
            expect(sessionIdManager['_enforceIdleTimeout']).toBeDefined()

            sessionIdManager.destroy()

            expect(sessionIdManager['_enforceIdleTimeout']).toBeUndefined()
            jest.useRealTimers()
        })

        it('removes the beforeunload event listener', () => {
            const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener')
            const sessionIdManager = sessionIdMgr(persistence)

            expect(sessionIdManager['_beforeUnloadListener']).toBeDefined()

            sessionIdManager.destroy()

            expect(removeEventListenerSpy).toHaveBeenCalledWith(
                'beforeunload',
                expect.any(Function),
                expect.objectContaining({ capture: false })
            )
            expect(sessionIdManager['_beforeUnloadListener']).toBeUndefined()

            removeEventListenerSpy.mockRestore()
        })

        it('clears session id changed handlers', () => {
            const sessionIdManager = sessionIdMgr(persistence)
            const mockHandler = jest.fn()

            sessionIdManager.onSessionId(mockHandler)
            expect(sessionIdManager['_sessionIdChangedHandlers']).toHaveLength(1)

            sessionIdManager.destroy()

            expect(sessionIdManager['_sessionIdChangedHandlers']).toHaveLength(0)
        })

        it('prevents timer from firing after destroy', async () => {
            jest.useFakeTimers()
            const sessionIdManager = sessionIdMgr(persistence)
            const mockHandler = jest.fn()

            sessionIdManager.on('forcedIdleReset', mockHandler)

            // Destroy before timer fires
            sessionIdManager.destroy()

            // Set up idle session
            const idleTimestamp = timestamp - (sessionIdManager.sessionTimeoutMs + 1000)
            persistence.props[SESSION_ID] = [idleTimestamp, 'oldSessionID', idleTimestamp]

            // Advance time past when the timer would have fired
            const idleTimeoutMs = sessionIdManager.sessionTimeoutMs * 1.1
            jest.advanceTimersByTime(idleTimeoutMs + 1000)

            // Handler should NOT have been called since we destroyed the manager
            expect(mockHandler).not.toHaveBeenCalled()

            jest.useRealTimers()
        })
    })
})

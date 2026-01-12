import * as fc from 'fast-check'
import { DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS, SessionIdManager } from '../sessionid'
import { SESSION_ID } from '../constants'
import { sessionStore } from '../storage'
import { PostHogConfig, Properties } from '../types'
import { PostHogPersistence } from '../posthog-persistence'
import { createMockPostHog } from './helpers/posthog-instance'

jest.mock('../uuidv7')
jest.mock('../storage')

const SESSION_LENGTH_LIMIT_MS = 24 * 3600 * 1000
const SESSION_TIMEOUT_MS = DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS * 1000

const arbitraryRecentTimestamp = fc.integer({ min: 1600000000000, max: 2000000000000 })

describe('SessionIdManager property-based tests', () => {
    let uuidCounter: number
    let persistence: { props: Properties } & Partial<PostHogPersistence>

    const config: Partial<PostHogConfig> = {
        persistence_name: 'test-persistence',
    }

    const sessionIdMgr = (phPersistence: Partial<PostHogPersistence>) =>
        new SessionIdManager(
            createMockPostHog({
                config: config as PostHogConfig,
                persistence: phPersistence as PostHogPersistence,
                register: jest.fn(),
            }),
            () => `session-${++uuidCounter}`,
            () => `window-${++uuidCounter}`
        )

    const resetPersistence = () => {
        persistence = {
            props: { [SESSION_ID]: undefined },
            register: jest.fn().mockImplementation((props) => {
                Object.assign(persistence.props, props)
            }),
            _disabled: false,
        }
    }

    beforeEach(() => {
        uuidCounter = 0
        resetPersistence()
        ;(sessionStore._is_supported as jest.Mock).mockReturnValue(true)
        ;(sessionStore._parse as jest.Mock).mockReturnValue(null)
    })

    it('generates new session when no session id exists', () => {
        fc.assert(
            fc.property(
                fc.record({
                    timestamp: arbitraryRecentTimestamp,
                    readOnly: fc.boolean(),
                }),
                ({ timestamp, readOnly }) => {
                    uuidCounter = 0
                    resetPersistence()
                    persistence.props[SESSION_ID] = undefined

                    const manager = sessionIdMgr(persistence)
                    const result = manager.checkAndGetSessionAndWindowId(readOnly, timestamp)

                    expect(result.sessionId).toBe('session-1')
                    expect(result.changeReason?.noSessionId).toBe(true)
                }
            ),
            { numRuns: 100 }
        )
    })

    it.each([
        { desc: 'all nulls', sessionData: [null, null, null] },
        { desc: 'null sessionId with timestamps', sessionData: [1600000000000, null, 1600000000000] },
        { desc: 'empty string sessionId', sessionData: [1600000000000, '', 1600000000000] },
        { desc: 'undefined sessionId', sessionData: [1600000000000, undefined, 1600000000000] },
    ])('generates new session with $desc', ({ sessionData }) => {
        fc.assert(
            fc.property(
                fc.record({
                    timestamp: arbitraryRecentTimestamp,
                    readOnly: fc.boolean(),
                }),
                ({ timestamp, readOnly }) => {
                    uuidCounter = 0
                    resetPersistence()
                    persistence.props[SESSION_ID] = sessionData

                    const manager = sessionIdMgr(persistence)
                    const result = manager.checkAndGetSessionAndWindowId(readOnly, timestamp)

                    expect(result.sessionId).toBe('session-1')
                    expect(result.changeReason?.noSessionId).toBe(true)
                }
            ),
            { numRuns: 50 }
        )
    })

    it('triggers activity timeout when not readOnly and session has been idle', () => {
        fc.assert(
            fc.property(
                fc.record({
                    currentTimestamp: arbitraryRecentTimestamp,
                    extraIdleTimeMs: fc.integer({ min: 1, max: 1000000 }),
                }),
                ({ currentTimestamp, extraIdleTimeMs }) => {
                    uuidCounter = 0
                    resetPersistence()
                    const lastActivityTimestamp = currentTimestamp - SESSION_TIMEOUT_MS - extraIdleTimeMs
                    const startTimestamp = lastActivityTimestamp - 1000

                    persistence.props[SESSION_ID] = [lastActivityTimestamp, 'existing-session', startTimestamp]
                    ;(sessionStore._parse as jest.Mock).mockReturnValue('existing-window')

                    const manager = sessionIdMgr(persistence)
                    const result = manager.checkAndGetSessionAndWindowId(false, currentTimestamp)

                    expect(result.changeReason?.activityTimeout).toBe(true)
                    expect(result.sessionId).toBe('session-1')
                }
            ),
            { numRuns: 100 }
        )
    })

    it('does not trigger activity timeout in readOnly mode even when session has been idle', () => {
        fc.assert(
            fc.property(
                fc.record({
                    currentTimestamp: arbitraryRecentTimestamp,
                    extraIdleTimeMs: fc.integer({ min: 1, max: 1000000 }),
                }),
                ({ currentTimestamp, extraIdleTimeMs }) => {
                    uuidCounter = 0
                    resetPersistence()
                    const lastActivityTimestamp = currentTimestamp - SESSION_TIMEOUT_MS - extraIdleTimeMs
                    const startTimestamp = lastActivityTimestamp - 1000

                    persistence.props[SESSION_ID] = [lastActivityTimestamp, 'existing-session', startTimestamp]
                    ;(sessionStore._parse as jest.Mock).mockReturnValue('existing-window')

                    const manager = sessionIdMgr(persistence)
                    const result = manager.checkAndGetSessionAndWindowId(true, currentTimestamp)

                    expect(result.sessionId).toBe('existing-session')
                    expect(result.changeReason).toBeUndefined()
                }
            ),
            { numRuns: 100 }
        )
    })

    it('triggers new session when past 24 hour limit regardless of readOnly', () => {
        fc.assert(
            fc.property(
                fc.record({
                    startTimestamp: arbitraryRecentTimestamp,
                    extraTimeMs: fc.integer({ min: 1, max: 1000000 }),
                    readOnly: fc.boolean(),
                }),
                ({ startTimestamp, extraTimeMs, readOnly }) => {
                    uuidCounter = 0
                    resetPersistence()
                    const currentTimestamp = startTimestamp + SESSION_LENGTH_LIMIT_MS + extraTimeMs
                    const lastActivityTimestamp = currentTimestamp - 1000

                    persistence.props[SESSION_ID] = [lastActivityTimestamp, 'existing-session', startTimestamp]
                    ;(sessionStore._parse as jest.Mock).mockReturnValue('existing-window')

                    const manager = sessionIdMgr(persistence)
                    const result = manager.checkAndGetSessionAndWindowId(readOnly, currentTimestamp)

                    expect(result.changeReason?.sessionPastMaximumLength).toBe(true)
                    expect(result.sessionId).toBe('session-1')
                }
            ),
            { numRuns: 100 }
        )
    })

    it('preserves session when within timeout and length limits', () => {
        fc.assert(
            fc.property(
                fc.record({
                    currentTimestamp: arbitraryRecentTimestamp,
                    timeSinceLastActivity: fc.integer({ min: 0, max: SESSION_TIMEOUT_MS - 1 }),
                    timeSinceStart: fc.integer({ min: 0, max: SESSION_LENGTH_LIMIT_MS - 1 }),
                    readOnly: fc.boolean(),
                }),
                ({ currentTimestamp, timeSinceLastActivity, timeSinceStart, readOnly }) => {
                    uuidCounter = 0
                    resetPersistence()
                    const lastActivityTimestamp = currentTimestamp - timeSinceLastActivity
                    const startTimestamp = currentTimestamp - timeSinceStart

                    persistence.props[SESSION_ID] = [lastActivityTimestamp, 'existing-session', startTimestamp]
                    ;(sessionStore._parse as jest.Mock).mockReturnValue('existing-window')

                    const manager = sessionIdMgr(persistence)
                    const result = manager.checkAndGetSessionAndWindowId(readOnly, currentTimestamp)

                    expect(result.sessionId).toBe('existing-session')
                    expect(result.changeReason).toBeUndefined()
                }
            ),
            { numRuns: 100 }
        )
    })

    describe('nullish timestamp handling (bug fix area)', () => {
        const invalidActivityTimestamps = [
            { desc: 'null', activityTimestamp: null },
            { desc: 'undefined', activityTimestamp: undefined },
            { desc: 'zero', activityTimestamp: 0 },
            { desc: 'negative', activityTimestamp: -1 },
        ]

        it.each(invalidActivityTimestamps)(
            '$desc activity timestamp preserves session and updates timestamp when not readOnly',
            ({ activityTimestamp }) => {
                fc.assert(
                    fc.property(
                        fc.record({ currentTimestamp: arbitraryRecentTimestamp, readOnly: fc.boolean() }),
                        ({ currentTimestamp, readOnly }) => {
                            const startTimestamp = currentTimestamp - 1000

                            uuidCounter = 0
                            resetPersistence()
                            persistence.props[SESSION_ID] = [activityTimestamp, 'existing-session', startTimestamp]
                            ;(sessionStore._parse as jest.Mock).mockReturnValue('existing-window')

                            const manager = sessionIdMgr(persistence)
                            const result = manager.checkAndGetSessionAndWindowId(readOnly, currentTimestamp)

                            expect(result.sessionId).toBe('existing-session')
                            expect(result.changeReason).toBeUndefined()

                            if (!readOnly) {
                                const registeredData = persistence.props[SESSION_ID] as [number, string, number]
                                expect(registeredData[0]).toBe(currentTimestamp)
                            }
                        }
                    ),
                    { numRuns: 50 }
                )
            }
        )

        const invalidStartTimestamps = [
            { desc: 'null', startTimestamp: null },
            { desc: 'undefined', startTimestamp: undefined },
            { desc: 'zero', startTimestamp: 0 },
            { desc: 'negative', startTimestamp: -1 },
        ]

        it.each(invalidStartTimestamps)(
            '$desc start timestamp preserves session and gets replaced with positive value',
            ({ startTimestamp }) => {
                fc.assert(
                    fc.property(arbitraryRecentTimestamp, (currentTimestamp) => {
                        uuidCounter = 0
                        resetPersistence()
                        const lastActivityTimestamp = currentTimestamp - 1000
                        persistence.props[SESSION_ID] = [lastActivityTimestamp, 'existing-session', startTimestamp]
                        ;(sessionStore._parse as jest.Mock).mockReturnValue('existing-window')

                        const manager = sessionIdMgr(persistence)
                        const result = manager.checkAndGetSessionAndWindowId(false, currentTimestamp)

                        expect(result.sessionId).toBe('existing-session')
                        expect(result.changeReason?.sessionPastMaximumLength).toBeFalsy()

                        const registeredData = persistence.props[SESSION_ID] as [number, string, number]
                        expect(registeredData[2]).toBeGreaterThan(0)
                    }),
                    { numRuns: 50 }
                )
            }
        )
    })

    it.each([
        { readOnly: true, expectPreserved: true },
        { readOnly: false, expectPreserved: false },
    ])(
        'readOnly=$readOnly preserves=$expectPreserved lastActivityTimestamp when session is valid',
        ({ readOnly, expectPreserved }) => {
            fc.assert(
                fc.property(
                    fc.record({
                        currentTimestamp: arbitraryRecentTimestamp,
                        timeSinceActivity: fc.integer({ min: 1, max: SESSION_TIMEOUT_MS - 1 }),
                    }),
                    ({ currentTimestamp, timeSinceActivity }) => {
                        const originalActivityTimestamp = currentTimestamp - timeSinceActivity

                        uuidCounter = 0
                        resetPersistence()
                        const startTimestamp = originalActivityTimestamp - 1000

                        persistence.props[SESSION_ID] = [originalActivityTimestamp, 'existing-session', startTimestamp]
                        ;(sessionStore._parse as jest.Mock).mockReturnValue('existing-window')

                        const manager = sessionIdMgr(persistence)
                        manager.checkAndGetSessionAndWindowId(readOnly, currentTimestamp)

                        const registeredData = persistence.props[SESSION_ID] as [number, string, number]
                        const expectedTimestamp = expectPreserved ? originalActivityTimestamp : currentTimestamp
                        expect(registeredData[0]).toBe(expectedTimestamp)
                    }
                ),
                { numRuns: 100 }
            )
        }
    )

    it('preserves existing window id or generates new one', () => {
        fc.assert(
            fc.property(
                fc.record({
                    timestamp: arbitraryRecentTimestamp,
                    hasExistingWindowId: fc.boolean(),
                    readOnly: fc.boolean(),
                }),
                ({ timestamp, hasExistingWindowId, readOnly }) => {
                    uuidCounter = 0
                    resetPersistence()
                    persistence.props[SESSION_ID] = [timestamp - 1000, 'existing-session', timestamp - 2000]
                    ;(sessionStore._parse as jest.Mock).mockReturnValue(hasExistingWindowId ? 'existing-window' : null)

                    const manager = sessionIdMgr(persistence)
                    const result = manager.checkAndGetSessionAndWindowId(readOnly, timestamp)

                    if (hasExistingWindowId) {
                        expect(result.windowId).toBe('existing-window')
                    } else {
                        expect(result.windowId).toMatch(/^window-/)
                        expect(result.changeReason?.noSessionId).toBe(false)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })

    it('preserves start timestamp across multiple calls within session', () => {
        fc.assert(
            fc.property(
                fc.record({
                    startTimestamp: arbitraryRecentTimestamp,
                    callCount: fc.integer({ min: 2, max: 10 }),
                }),
                ({ startTimestamp, callCount }) => {
                    uuidCounter = 0
                    resetPersistence()
                    let currentTimestamp = startTimestamp + 1000
                    const activityIncrement = Math.floor(SESSION_TIMEOUT_MS / (callCount + 1))

                    persistence.props[SESSION_ID] = [startTimestamp, 'existing-session', startTimestamp]
                    ;(sessionStore._parse as jest.Mock).mockReturnValue('existing-window')

                    const manager = sessionIdMgr(persistence)

                    for (let i = 0; i < callCount; i++) {
                        currentTimestamp += activityIncrement
                        const result = manager.checkAndGetSessionAndWindowId(false, currentTimestamp)
                        expect(result.sessionStartTimestamp).toBe(startTimestamp)
                    }
                }
            ),
            { numRuns: 50 }
        )
    })

    it('same inputs produce consistent sessionId (idempotency)', () => {
        fc.assert(
            fc.property(
                fc.record({
                    timestamp: arbitraryRecentTimestamp,
                    readOnly: fc.boolean(),
                    lastActivityTimestamp: arbitraryRecentTimestamp,
                    startTimestamp: arbitraryRecentTimestamp,
                }),
                ({ timestamp, readOnly, lastActivityTimestamp, startTimestamp }) => {
                    fc.pre(timestamp > lastActivityTimestamp)
                    fc.pre(lastActivityTimestamp > startTimestamp)

                    uuidCounter = 0
                    resetPersistence()
                    persistence.props[SESSION_ID] = [lastActivityTimestamp, 'existing-session', startTimestamp]
                    ;(sessionStore._parse as jest.Mock).mockReturnValue('existing-window')

                    const manager = sessionIdMgr(persistence)
                    const result1 = manager.checkAndGetSessionAndWindowId(readOnly, timestamp)
                    const result2 = manager.checkAndGetSessionAndWindowId(readOnly, timestamp)

                    expect(result1.sessionId).toBe(result2.sessionId)
                    expect(result1.windowId).toBe(result2.windowId)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('two-element session data array gets startTimestamp populated (legacy migration)', () => {
        fc.assert(
            fc.property(
                fc.record({
                    lastActivityTimestamp: arbitraryRecentTimestamp,
                    currentTimestamp: arbitraryRecentTimestamp,
                }),
                ({ lastActivityTimestamp, currentTimestamp }) => {
                    fc.pre(currentTimestamp >= lastActivityTimestamp)
                    fc.pre(currentTimestamp - lastActivityTimestamp < SESSION_TIMEOUT_MS)

                    uuidCounter = 0
                    resetPersistence()
                    persistence.props[SESSION_ID] = [lastActivityTimestamp, 'existing-session']
                    ;(sessionStore._parse as jest.Mock).mockReturnValue('existing-window')

                    const manager = sessionIdMgr(persistence)
                    const result = manager.checkAndGetSessionAndWindowId(false, currentTimestamp)

                    expect(result.sessionId).toBe('existing-session')
                    expect(result.sessionStartTimestamp).toBe(lastActivityTimestamp)
                }
            ),
            { numRuns: 50 }
        )
    })
})

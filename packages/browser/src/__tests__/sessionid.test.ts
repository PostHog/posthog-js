import {
    ACTIVITY_TIMESTAMP_PERSIST_GRANULARITY_MS,
    DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS,
    MAX_SESSION_IDLE_TIMEOUT_SECONDS,
    MIN_SESSION_IDLE_TIMEOUT_SECONDS,
    SessionIdManager,
} from '../sessionid'
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
            load: jest.fn(),
            flush: jest.fn(),
            refreshKey: jest.fn(),
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
                    crossTabAdoption: false,
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
                    crossTabAdoption: false,
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
                    crossTabAdoption: false,
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
                    crossTabAdoption: false,
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
                    crossTabAdoption: false,
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

    describe('activity timestamp persistence granularity', () => {
        // Activity timestamp is updated on every event capture (4+ times
        // per second). Persisting on every call writes the entire props
        // blob to localStorage and broadcasts it cross-tab via storage
        // events. We persist only when the value moves enough to matter
        // for idle detection. In-memory state always stays at full
        // resolution.
        it('persists the first activity timestamp', () => {
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('id', 1_000_000, 1_000_000)
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [1_000_000, 'id', 1_000_000],
            })
        })

        it.each([
            { label: '+1ms', delta: 1 },
            { label: '+999ms', delta: 999 },
            { label: '+4_999ms', delta: 4_999 },
        ])('does not persist activity-only change $label (under granularity)', ({ delta }) => {
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('id', 1_000_000, 1_000_000)
            ;(persistence.register as jest.Mock).mockClear()

            sessionIdManager['_setSessionId']('id', 1_000_000 + delta, 1_000_000)
            expect(persistence.register).not.toHaveBeenCalled()
        })

        it.each([
            { label: '+5_000ms (boundary)', delta: 5_000 },
            { label: '+5_001ms', delta: 5_001 },
            { label: '+60_000ms', delta: 60_000 },
        ])('persists activity-only change $label (crosses granularity)', ({ delta }) => {
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('id', 1_000_000, 1_000_000)
            ;(persistence.register as jest.Mock).mockClear()

            sessionIdManager['_setSessionId']('id', 1_000_000 + delta, 1_000_000)
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [1_000_000 + delta, 'id', 1_000_000],
            })
        })

        it('persists immediately when sessionId changes, regardless of timestamp delta', () => {
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('id1', 1_000_000, 1_000_000)
            ;(persistence.register as jest.Mock).mockClear()

            sessionIdManager['_setSessionId']('id2', 1_000_001, 1_000_000)
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [1_000_001, 'id2', 1_000_000],
            })
        })

        it('persists immediately when startTimestamp changes, regardless of timestamp delta', () => {
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('id', 1_000_000, 1_000_000)
            ;(persistence.register as jest.Mock).mockClear()

            sessionIdManager['_setSessionId']('id', 1_000_001, 2_000_000)
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [1_000_001, 'id', 2_000_000],
            })
        })

        it('keeps in-memory activity timestamp at full resolution when persistence is skipped', () => {
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('id', 1_000_000, 1_000_000)
            sessionIdManager['_setSessionId']('id', 1_000_001, 1_000_000)
            // Under the 5_000 ms granularity, persistence is skipped, but the
            // in-memory value still reflects the latest tick — important for
            // any in-process readers and for the next granularity comparison.
            expect(sessionIdManager['_sessionActivityTimestamp']).toBe(1_000_001)
        })

        it('compares against last persisted, not last in-memory', () => {
            // Six 1_000 ms increments — none on its own crosses 5_000 ms,
            // but the cumulative delta does. We must compare to the
            // last-persisted value, not the previous in-memory tick.
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('id', 1_000_000, 1_000_000) // persisted (first)
            ;(persistence.register as jest.Mock).mockClear()

            sessionIdManager['_setSessionId']('id', 1_001_000, 1_000_000) // +1s
            sessionIdManager['_setSessionId']('id', 1_002_000, 1_000_000) // +2s
            sessionIdManager['_setSessionId']('id', 1_003_000, 1_000_000) // +3s
            sessionIdManager['_setSessionId']('id', 1_004_000, 1_000_000) // +4s
            expect(persistence.register).not.toHaveBeenCalled()

            sessionIdManager['_setSessionId']('id', 1_005_000, 1_000_000) // +5s, crosses
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [1_005_000, 'id', 1_000_000],
            })
        })

        it('persists immediately after resetSessionId, even within granularity window', () => {
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('id', 1_000_000, 1_000_000)
            sessionIdManager.resetSessionId() // persists null tuple
            ;(persistence.register as jest.Mock).mockClear()

            // After reset, the next real value is sessionId-changed
            // (was null, now string) so it persists regardless of timestamp.
            sessionIdManager['_setSessionId']('id', 1_000_001, 1_000_001)
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [1_000_001, 'id', 1_000_001],
            })
        })

        it.each([
            { label: '-1ms (within granularity)', delta: -1, shouldPersist: false },
            { label: '-4_999ms', delta: -4_999, shouldPersist: false },
            { label: '-5_000ms (boundary)', delta: -5_000, shouldPersist: true },
            { label: '-6_000ms (clock-skew jump)', delta: -6_000, shouldPersist: true },
        ])('handles backward activity-only delta $label', ({ delta, shouldPersist }) => {
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('id', 1_000_000, 1_000_000)
            ;(persistence.register as jest.Mock).mockClear()

            sessionIdManager['_setSessionId']('id', 1_000_000 + delta, 1_000_000)
            if (shouldPersist) {
                expect(persistence.register).toHaveBeenCalledWith({
                    [SESSION_ID]: [1_000_000 + delta, 'id', 1_000_000],
                })
            } else {
                expect(persistence.register).not.toHaveBeenCalled()
            }
        })

        it('compares against the new persisted baseline after an id change', () => {
            // After a session-id change, subsequent activity-only ticks
            // should be throttled against the *new* persisted baseline,
            // not the prior session's last value.
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('id1', 1_000_000, 1_000_000)
            sessionIdManager['_setSessionId']('id2', 1_010_000, 1_010_000) // id change, new baseline
            ;(persistence.register as jest.Mock).mockClear()

            // +1s from new baseline — within granularity, must not persist
            sessionIdManager['_setSessionId']('id2', 1_011_000, 1_010_000)
            expect(persistence.register).not.toHaveBeenCalled()

            // +5_001ms from new baseline — crosses granularity, must persist
            sessionIdManager['_setSessionId']('id2', 1_015_001, 1_010_000)
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [1_015_001, 'id2', 1_010_000],
            })
        })

        it('persist granularity stays well under the minimum idle timeout', () => {
            // The throttle is only safe while the persist granularity is
            // a small fraction of the minimum idle timeout. If someone
            // shrinks the min idle timeout (or grows the granularity)
            // without thinking about this invariant, idle detection on
            // other tabs could fire on stale data.
            expect(MIN_SESSION_IDLE_TIMEOUT_SECONDS * 1000).toBeGreaterThanOrEqual(
                6 * ACTIVITY_TIMESTAMP_PERSIST_GRANULARITY_MS
            )
        })

        it('flushes the pending activity timestamp on destroy', () => {
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('id', 1_000_000, 1_000_000) // persisted (baseline)
            sessionIdManager['_setSessionId']('id', 1_001_000, 1_000_000) // suppressed
            ;(persistence.register as jest.Mock).mockClear()

            sessionIdManager.destroy()
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [1_001_000, 'id', 1_000_000],
            })
        })

        it('destroy is a no-op for the throttle when in-memory matches persisted', () => {
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('id', 1_000_000, 1_000_000)
            ;(persistence.register as jest.Mock).mockClear()

            sessionIdManager.destroy()
            expect(persistence.register).not.toHaveBeenCalled()
        })

        it('does not rotate session early when in-memory activity is fresher than persisted', () => {
            // Throttled scenario: persisted activity sits at T0 while in-memory
            // has advanced by less than the granularity. With idle timeout T,
            // a query at T0 + T - 1 must NOT rotate the session because real
            // last activity is still inside the timeout — but a naive check
            // against the stale persisted value would think we have been
            // idle for T0 + T - 1 - T0 = T - 1 ... wait, that's fine.
            //
            // The actual failure mode needs the in-memory to have advanced
            // since the last persist. Set up: persist at 1_000_000, then a
            // throttled tick at 1_004_999 (in-memory advances, persisted
            // stays at 1_000_000). Query at 1_004_999 + DEFAULT_TIMEOUT - 1.
            //   real idle    = (1_004_999 + T - 1) - 1_004_999 = T - 1  (NOT idle)
            //   stale-only   = (1_004_999 + T - 1) - 1_000_000 = T + 4_998  (idle)
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('sessionA', 1_000_000, 1_000_000)
            sessionIdManager['_setSessionId']('sessionA', 1_004_999, 1_000_000)

            const timeoutMs = DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS * 1000
            const queryTime = 1_004_999 + timeoutMs - 1
            const result = sessionIdManager.checkAndGetSessionAndWindowId(false, queryTime)

            expect(result.sessionId).toBe('sessionA')
            expect(result.changeReason).toBeUndefined()
        })

        it('flush does not clobber a cross-tab session rotation', () => {
            // Tab A persists session A, then a throttled tick leaves a
            // pending in-memory activity that has not been persisted yet.
            // Meanwhile Tab B rotates the session to B and writes it to
            // shared storage. When Tab A unloads, _flushPendingActivityTimestamp
            // must not overwrite Tab B's session.
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('sessionA', 1_000_000, 1_000_000)
            sessionIdManager['_setSessionId']('sessionA', 1_004_000, 1_000_000) // throttled
            ;(persistence.register as jest.Mock).mockClear()

            // Simulate Tab B's cross-tab rotation
            persistence.props[SESSION_ID] = [2_000_000, 'sessionB', 2_000_000]

            sessionIdManager['_flushPendingActivityTimestamp']()
            expect(persistence.register).not.toHaveBeenCalled()
            expect(persistence.props[SESSION_ID]).toEqual([2_000_000, 'sessionB', 2_000_000])
        })

        it('flush does not clobber a cross-tab rotation when debounce is enabled', () => {
            // The debounce>0 regression: a leading whole-blob flush() would
            // write our stale SESSION_ID over the sibling's rotation before
            // we read it, defeating the mismatch guard. Per-key refresh reads
            // SESSION_ID without writing, so the sibling's rotation survives.
            config.persistence_save_debounce_ms = 250
            try {
                const sessionIdManager = sessionIdMgr(persistence)
                sessionIdManager['_setSessionId']('sessionA', 1_000_000, 1_000_000)
                sessionIdManager['_setSessionId']('sessionA', 1_004_000, 1_000_000) // throttled
                ;(persistence.register as jest.Mock).mockClear()

                // Sibling rotated to sessionB in storage; refreshKey pulls it in.
                ;(persistence.refreshKey as jest.Mock).mockImplementation(() => {
                    persistence.props[SESSION_ID] = [2_000_000, 'sessionB', 2_000_000]
                })

                sessionIdManager['_flushPendingActivityTimestamp']()

                // Guard skips before any write: refreshKey read the sibling
                // rotation, and we never flushed our stale blob.
                expect(persistence.refreshKey).toHaveBeenCalledWith(SESSION_ID)
                expect(persistence.flush).not.toHaveBeenCalled()
                expect(persistence.register).not.toHaveBeenCalled()
                expect(persistence.props[SESSION_ID]).toEqual([2_000_000, 'sessionB', 2_000_000])
            } finally {
                delete config.persistence_save_debounce_ms
            }
        })

        it('flush proceeds when persisted session still matches the tab', () => {
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('sessionA', 1_000_000, 1_000_000)
            sessionIdManager['_setSessionId']('sessionA', 1_004_000, 1_000_000) // throttled
            ;(persistence.register as jest.Mock).mockClear()

            sessionIdManager['_flushPendingActivityTimestamp']()
            expect(persistence.register).toHaveBeenCalledWith({
                [SESSION_ID]: [1_004_000, 'sessionA', 1_000_000],
            })
        })

        it('flush refreshes SESSION_ID from storage, registers, then forces the debounced write (hardened path)', () => {
            // With persistence_save_debounce_ms > 0, a whole-blob flush()
            // would clobber a sibling SESSION_ID write before we read it.
            // Per-key refresh reads only SESSION_ID and writes nothing, so
            // neither side is clobbered. The trailing flush() forces the
            // SESSION_ID register past the debounce.
            config.persistence_save_debounce_ms = 250
            try {
                const order: string[] = []
                ;(persistence.flush as jest.Mock).mockImplementation(() => order.push('flush'))
                ;(persistence.refreshKey as jest.Mock).mockImplementation(() => order.push('refreshKey'))
                ;(persistence.register as jest.Mock).mockImplementation((props) => {
                    Object.assign(persistence.props, props)
                    order.push('register')
                })

                const sessionIdManager = sessionIdMgr(persistence)
                sessionIdManager['_setSessionId']('sessionA', 1_000_000, 1_000_000)
                sessionIdManager['_setSessionId']('sessionA', 1_004_000, 1_000_000) // throttled
                order.length = 0

                sessionIdManager['_flushPendingActivityTimestamp']()
                expect(order).toEqual(['refreshKey', 'register', 'flush'])
            } finally {
                delete config.persistence_save_debounce_ms
            }
        })

        it('flush uses legacy flush+load when debounce is disabled', () => {
            // With debounce off, flush() is a no-op (no pending timer) so it
            // cannot clobber storage, and load() picks up sibling writes.
            const order: string[] = []
            ;(persistence.flush as jest.Mock).mockImplementation(() => order.push('flush'))
            ;(persistence.load as jest.Mock).mockImplementation(() => order.push('load'))
            ;(persistence.refreshKey as jest.Mock).mockImplementation(() => order.push('refreshKey'))
            ;(persistence.register as jest.Mock).mockImplementation((props) => {
                Object.assign(persistence.props, props)
                order.push('register')
            })

            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('sessionA', 1_000_000, 1_000_000)
            sessionIdManager['_setSessionId']('sessionA', 1_004_000, 1_000_000) // throttled
            order.length = 0

            sessionIdManager['_flushPendingActivityTimestamp']()
            expect(order).toEqual(['flush', 'load', 'register', 'flush'])
        })

        it('checkAndGetSessionAndWindowId does not rotate when a sibling tab has been active', () => {
            // This tab last persisted at t=1_000_000; it has been idle since.
            // A sibling tab has since written a recent activity timestamp
            // (simulated by mutating persistence.props directly — `load()`
            // is a no-op in the mock, so this stands in for "storage was
            // updated by another tab and we re-read it").
            ;(sessionStore._parse as jest.Mock).mockReturnValue('stable-window-id')
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('sessionA', 1_000_000, 1_000_000)

            // Use the actual configured timeout so the test is robust to
            // shared-config mutations by other tests in this file.
            const queryTime = 1_000_000 + sessionIdManager.sessionTimeoutMs + 5_000
            // Sibling tab wrote 1 second ago, so the session is alive.
            persistence.props[SESSION_ID] = [queryTime - 1_000, 'sessionA', 1_000_000]

            const result = sessionIdManager.checkAndGetSessionAndWindowId(false, queryTime)
            expect(result.sessionId).toBe('sessionA')
            expect(result.changeReason?.activityTimeout).toBeFalsy()
        })

        it('checkAndGetSessionAndWindowId rotates when cross-tab refresh confirms idle', () => {
            ;(sessionStore._parse as jest.Mock).mockReturnValue('stable-window-id')
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('sessionA', 1_000_000, 1_000_000)

            const queryTime = 1_000_000 + sessionIdManager.sessionTimeoutMs + 5_000
            const result = sessionIdManager.checkAndGetSessionAndWindowId(false, queryTime)
            expect(result.sessionId).not.toBe('sessionA')
            expect(result.changeReason?.activityTimeout).toBe(true)
        })
    })

    describe('reset session id', () => {
        it('clears the existing session id', () => {
            sessionIdMgr(persistence).resetSessionId()
            expect(persistence.register).toHaveBeenCalledWith({ [SESSION_ID]: [null, null, null] })
        })

        it('clears the idle timer so a stale fire cannot rotate the reset session', () => {
            jest.useFakeTimers()
            try {
                const sessionIdManager = sessionIdMgr(persistence)
                ;(persistence.register as jest.Mock).mockClear()

                sessionIdManager.resetSessionId()
                ;(persistence.register as jest.Mock).mockClear()

                // Advance well past the idle timer's scheduled fire time.
                // Without the clear, the queued timer would fire here and
                // call resetSessionId again on a session that's already null.
                jest.advanceTimersByTime(sessionIdManager.sessionTimeoutMs * 2)

                expect(persistence.register).not.toHaveBeenCalled()
            } finally {
                jest.useRealTimers()
            }
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

    describe('idle detection uses freshest known activity', () => {
        // Idle detection compares the current wall clock against the
        // freshest activity timestamp known to the manager — `max(persisted,
        // in-memory)`. This covers both directions of drift between the
        // two views (throttled in-memory ahead of persisted; or persisted
        // ahead of in-memory because a sibling tab kept the session alive).

        const memoryConfig = {
            persistence_name: 'test-session-memory',
            persistence: 'memory',
            token: 'test-token',
        } as PostHogConfig

        it.each([
            { description: 'just past timeout', offsetMs: 1 },
            { description: 'well past timeout', offsetMs: 1000 },
        ])('rotates the session when wall clock crosses timeout ($description)', ({ offsetMs }) => {
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

            // Tab freezes here. Nothing calls `_setSessionId` while frozen,
            // so both in-memory and persisted stay at testTimestamp.
            // Wall clock advances past the idle timeout; the tab thaws and
            // queries again — the session must rotate.
            const queryTimestamp = testTimestamp + DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS * 1000 + offsetMs
            const secondResult = sessionIdManager.checkAndGetSessionAndWindowId(false, queryTimestamp)

            expect(secondResult.changeReason?.activityTimeout).toBe(true)
        })

        it('does not rotate when persisted is older than in-memory (in-memory wins)', () => {
            // A sibling write that lands an older value into persistence
            // (e.g. a race during cross-tab restoration) must not cause
            // this tab to spuriously time out — in-memory has the freshest
            // local view.
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

            sessionIdManager.checkAndGetSessionAndWindowId(false, testTimestamp)

            const staleTimestamp = testTimestamp - (DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS * 1000 + 1000)
            realPersistence.register({ [SESSION_ID]: [staleTimestamp, 'newUUID', staleTimestamp] })

            const secondResult = sessionIdManager.checkAndGetSessionAndWindowId(false, testTimestamp)
            expect(secondResult.changeReason?.activityTimeout).toBeUndefined()
        })
    })

    describe('cross-tab refresh hardening', () => {
        // Each test pins an exact failure mode the cross-tab refresh prevents.
        // The hardening is gated on persistence_save_debounce_ms > 0.

        beforeEach(() => {
            config.persistence_save_debounce_ms = 250
        })

        afterEach(() => {
            delete config.persistence_save_debounce_ms
        })

        it('cross-tab refresh pulls only the SESSION_ID slot from storage', () => {
            // The cross-tab refresh path must NOT do a whole-blob
            // flush+load — that would write tab B's stale props to storage
            // (clobbering sibling writes) before reading them back.
            ;(sessionStore._parse as jest.Mock).mockReturnValue('stable-window-id')
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('sessionA', 1_000_000, 1_000_000)

            const queryTime = 1_000_000 + sessionIdManager.sessionTimeoutMs + 5_000
            sessionIdManager.checkAndGetSessionAndWindowId(false, queryTime)

            expect(persistence.refreshKey).toHaveBeenCalledWith(SESSION_ID)
            expect(persistence.load).not.toHaveBeenCalled()
        })

        it('does not clobber a sibling tab session id when cross-tab refresh keeps the session alive', () => {
            // Tab A has stale view (sessionA). Tab B rotated to sessionB
            // in storage and wrote a recent activity timestamp. Tab A's
            // next event capture triggers cross-tab refresh; activityTimeout
            // becomes false (sibling kept it alive) so we don't rotate.
            // BUT we must not write Tab A's stale sessionA back via
            // _setSessionId — we'd clobber Tab B's rotation. The fix is to
            // re-sample _getSessionId() after the refresh.
            ;(sessionStore._parse as jest.Mock).mockReturnValue('stable-window-id')
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('sessionA', 1_000_000, 1_000_000)

            const queryTime = 1_000_000 + sessionIdManager.sessionTimeoutMs + 5_000

            // Simulate the cross-tab refresh seeing the sibling's rotation:
            // refreshKey mutates props[SESSION_ID] to reflect the sibling.
            ;(persistence.refreshKey as jest.Mock).mockImplementation(() => {
                persistence.props[SESSION_ID] = [queryTime - 1_000, 'sessionB', queryTime - 1_000]
            })

            const result = sessionIdManager.checkAndGetSessionAndWindowId(false, queryTime)

            // No rotation should have happened (sibling kept it alive).
            expect(result.changeReason?.activityTimeout).toBeFalsy()
            // And we must have written sessionB back, not sessionA.
            expect(persistence.register).toHaveBeenLastCalledWith({
                [SESSION_ID]: [expect.any(Number), 'sessionB', queryTime - 1_000],
            })
        })

        it('idle timer does not re-arm after destroy()', async () => {
            jest.useFakeTimers()
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('sessionA', 1_000_000, 1_000_000)

            // Simulate a sibling tab keeping the session alive so the timer
            // would normally re-arm.
            ;(persistence.refreshKey as jest.Mock).mockImplementation(() => {
                persistence.props[SESSION_ID] = [Date.now() - 100, 'sessionA', 1_000_000]
            })

            // Destroy while a timer is pending.
            sessionIdManager.destroy()

            // Advance well past any timer that might still be queued.
            jest.advanceTimersByTime(sessionIdManager.sessionTimeoutMs * 5)

            // The destroyed instance must not have re-armed.
            expect(sessionIdManager['_enforceIdleTimeout']).toBeUndefined()
            jest.useRealTimers()
        })
    })

    describe('cross-tab refresh legacy path (debounce disabled)', () => {
        // Without `persistence_save_debounce_ms`, the cross-tab refresh
        // path falls back to the prior `flush() + load()` cycle. Handler
        // emission is NOT gated: an adopted session id that handlers don't
        // hear about leaves consumers on the old session.

        it('falls back to flush + load when debounce is disabled', () => {
            ;(sessionStore._parse as jest.Mock).mockReturnValue('stable-window-id')
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('sessionA', 1_000_000, 1_000_000)

            const queryTime = 1_000_000 + sessionIdManager.sessionTimeoutMs + 5_000
            sessionIdManager.checkAndGetSessionAndWindowId(false, queryTime)

            expect(persistence.flush).toHaveBeenCalled()
            expect(persistence.load).toHaveBeenCalled()
            expect(persistence.refreshKey).not.toHaveBeenCalled()
        })

        it('emits onSessionId handlers with crossTabAdoption when observing a sibling rotation (debounce disabled)', () => {
            ;(sessionStore._parse as jest.Mock).mockReturnValue('stable-window-id')
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager['_setSessionId']('sessionA', 1_000_000, 1_000_000)

            const queryTime = 1_000_000 + sessionIdManager.sessionTimeoutMs + 5_000

            ;(persistence.load as jest.Mock).mockImplementation(() => {
                persistence.props[SESSION_ID] = [queryTime - 1_000, 'sessionB', queryTime - 1_000]
            })

            const handler = jest.fn()
            sessionIdManager.onSessionId(handler)
            handler.mockClear()

            sessionIdManager.checkAndGetSessionAndWindowId(false, queryTime)

            expect(handler).toHaveBeenCalledWith('sessionB', 'stable-window-id', {
                noSessionId: false,
                activityTimeout: false,
                sessionPastMaximumLength: false,
                crossTabAdoption: true,
            })
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

    describe('rotateSessionForReplaySize', () => {
        it('mints a new session and notifies handlers with sessionMaximumSize (not a reset)', () => {
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager.checkAndGetSessionAndWindowId(undefined, timestamp)
            const handler = jest.fn()
            sessionIdManager.onSessionId(handler)
            handler.mockClear() // ignore the immediate emit on registration
            ;(uuidv7 as jest.Mock).mockReturnValue('rotated-id')

            sessionIdManager.rotateSessionForReplaySize()

            expect(handler).toHaveBeenCalledTimes(1)
            expect(handler).toHaveBeenCalledWith(
                'rotated-id',
                'rotated-id',
                expect.objectContaining({ sessionMaximumSize: true, noSessionId: false })
            )
        })

        it('persists the rotated session id so it is read back', () => {
            const sessionIdManager = sessionIdMgr(persistence)
            sessionIdManager.checkAndGetSessionAndWindowId(undefined, timestamp)
            ;(uuidv7 as jest.Mock).mockReturnValue('rotated-id')

            sessionIdManager.rotateSessionForReplaySize()

            expect(sessionIdManager.checkAndGetSessionAndWindowId(true, now).sessionId).toEqual('rotated-id')
        })
    })
})

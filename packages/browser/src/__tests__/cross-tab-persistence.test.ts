/// <reference lib="dom" />
import { PostHogPersistence } from '../posthog-persistence'
import { SessionIdManager } from '../sessionid'
import { SESSION_ID } from '../constants'
import { PostHogConfig, Properties } from '../types'
import { resetLocalStorageSupported } from '../storage'
import { createMockPostHog } from './helpers/posthog-instance'

// These tests document the contract between two tabs that share localStorage.
// They use two REAL PostHogPersistence instances pointing at the same
// persistence_name, so flush/load/register all touch the same on-disk blob.
//
// A "tab" here is a (PostHogPersistence + SessionIdManager) pair. Both pairs
// share localStorage, so writes from one are visible to the other when its
// next refresh runs.
//
// The cross-tab idle refresh is GATED on persistence_save_debounce_ms > 0
// (`_useCrossTabRefreshHardening`). So every behavioural guarantee is proven
// against BOTH paths:
//   - legacy path  (debounce = 0):   idle refresh uses flush() + load()
//   - hardened path (debounce = 250): idle refresh uses refreshKey(SESSION_ID)
//
// Reading guide:
//   ACCEPT  — state tab B should take from a sibling.
//   REJECT  — state tab B must NOT take from a sibling.
//   PRESERVE — tab B's own state that must survive a refresh.
//   KNOWN LIMITATION — behaviour that is broken by design on a given path.
//
// The legacy path cannot protect a local pending write from clobbering a
// sibling, because with debounce disabled `register()` writes the whole
// props blob to storage immediately. Those "pending write survives" cases
// therefore live in a hardened-only block, with the legacy clobber pinned
// explicitly so the contrast is not lost.

const SHARED_TOKEN = 'shared-token-cross-tab'
const SHARED_NAME = 'shared-persistence-name'
const TIMEOUT_SECONDS = 60
const TIMEOUT_MS = TIMEOUT_SECONDS * 1000
const HARDENED_DEBOUNCE_MS = 250
const STORAGE_KEY = 'ph_' + SHARED_NAME
const T0 = 1_000_000

interface Tab {
    manager: SessionIdManager
    persistence: PostHogPersistence
}

const makeConfig = (debounceMs: number, overrides: Partial<PostHogConfig> = {}): PostHogConfig =>
    ({
        token: SHARED_TOKEN,
        persistence_name: SHARED_NAME,
        persistence: 'localStorage',
        session_idle_timeout_seconds: TIMEOUT_SECONDS,
        persistence_save_debounce_ms: debounceMs,
        api_host: 'https://test.example',
        ...overrides,
    }) as unknown as PostHogConfig

const buildTab = (
    debounceMs: number,
    opts: { sessionId?: string; windowId?: string; config?: Partial<PostHogConfig> } = {}
): Tab => {
    const config = makeConfig(debounceMs, opts.config)
    const persistence = new PostHogPersistence(config)
    const instance = createMockPostHog({
        config,
        persistence,
        register: jest.fn(),
    })
    const manager = new SessionIdManager(
        instance,
        opts.sessionId ? () => opts.sessionId! : undefined,
        opts.windowId ? () => opts.windowId! : undefined
    )
    return { manager, persistence }
}

const readStorage = (): Properties => {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
}

const storageSessionId = () => readStorage()[SESSION_ID]

const CASES = [
    { label: 'legacy path (debounce=0)', debounce: 0, hardened: false },
    { label: 'hardened path (debounce=250)', debounce: HARDENED_DEBOUNCE_MS, hardened: true },
]

describe('cross-tab persistence interactions', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        window.localStorage.clear()
        resetLocalStorageSupported()
    })

    afterEach(() => {
        jest.clearAllTimers()
        jest.useRealTimers()
        window.localStorage.clear()
    })

    describe.each(CASES)('$label', ({ debounce, hardened }) => {
        const makeTab = (opts: { sessionId?: string; windowId?: string; config?: Partial<PostHogConfig> } = {}): Tab =>
            buildTab(debounce, opts)

        describe('single tab baseline', () => {
            it('first checkAndGet generates and persists a session id', () => {
                const tab = makeTab({ sessionId: 'session-A', windowId: 'window-A' })

                const result = tab.manager.checkAndGetSessionAndWindowId(false, T0)
                tab.persistence.flush()

                expect(result.sessionId).toBe('session-A')
                expect(result.changeReason?.noSessionId).toBe(true)
                expect(storageSessionId()).toEqual([T0, 'session-A', T0])
            })

            it('subsequent checkAndGet within idle window keeps the session', () => {
                const tab = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tab.manager.checkAndGetSessionAndWindowId(false, T0)

                const result = tab.manager.checkAndGetSessionAndWindowId(false, T0 + 10_000)

                expect(result.sessionId).toBe('session-A')
                expect(result.changeReason).toBeUndefined()
            })

            it('checkAndGet past idle threshold rotates the session', () => {
                const tab = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tab.manager.checkAndGetSessionAndWindowId(false, T0)
                tab.persistence.flush()

                const rotated = makeTab({ sessionId: 'session-A-rotated', windowId: 'window-A' })
                const result = rotated.manager.checkAndGetSessionAndWindowId(false, T0 + TIMEOUT_MS + 5_000)

                expect(result.sessionId).toBe('session-A-rotated')
                expect(result.changeReason?.activityTimeout).toBe(true)
            })
        })

        describe('opening a second tab', () => {
            const seedTabA = () => {
                const tabA = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tabA.manager.checkAndGetSessionAndWindowId(false, T0)
                tabA.persistence.flush()
                return tabA
            }

            it('tab B inherits the session id from storage on its first checkAndGet', () => {
                seedTabA()
                const tabB = makeTab({ sessionId: 'session-B', windowId: 'window-B' })

                const result = tabB.manager.checkAndGetSessionAndWindowId(false, T0 + 100)

                expect(result.sessionId).toBe('session-A')
                expect(result.changeReason?.noSessionId).toBe(false)
                expect(result.changeReason?.activityTimeout).toBe(false)
            })

            it('tab B has its own window id, distinct from tab A', () => {
                seedTabA()
                const tabB = makeTab({ sessionId: 'session-B', windowId: 'window-B' })

                const result = tabB.manager.checkAndGetSessionAndWindowId(false, T0 + 100)

                expect(result.windowId).toBe('window-B')
                expect(result.windowId).not.toBe('window-A')
            })
        })

        describe('sibling tab is keeping the session alive', () => {
            const setupAliveSibling = (): { tabA: Tab; tabB: Tab; freshActivityAt: number } => {
                const tabA = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tabA.manager.checkAndGetSessionAndWindowId(false, T0)
                tabA.persistence.flush()

                const tabB = makeTab({ sessionId: 'session-B', windowId: 'window-B' })
                tabB.manager.checkAndGetSessionAndWindowId(false, T0 + 100)
                tabB.persistence.flush()

                const freshActivityAt = T0 + 30_000
                tabA.manager.checkAndGetSessionAndWindowId(false, freshActivityAt)
                tabA.persistence.flush()

                return { tabA, tabB, freshActivityAt }
            }

            it('ACCEPT — tab B keeps the session alive', () => {
                const { tabB, freshActivityAt } = setupAliveSibling()

                const result = tabB.manager.checkAndGetSessionAndWindowId(false, freshActivityAt + TIMEOUT_MS - 5_000)
                tabB.persistence.flush()

                expect(result.sessionId).toBe('session-A')
                expect(storageSessionId()[1]).toBe('session-A')
            })

            it('PRESERVE — sibling fresh activity timestamp survives tab B refresh', () => {
                const { tabB, freshActivityAt } = setupAliveSibling()

                tabB.manager.checkAndGetSessionAndWindowId(false, freshActivityAt + TIMEOUT_MS - 5_000)
                tabB.persistence.flush()

                expect(storageSessionId()[0]).toBeGreaterThanOrEqual(freshActivityAt)
            })

            it('ACCEPT — repeated sibling activity bumps continue to extend the session', () => {
                const { tabA, tabB, freshActivityAt } = setupAliveSibling()

                tabA.manager.checkAndGetSessionAndWindowId(false, freshActivityAt + 20_000)
                tabA.persistence.flush()
                tabA.manager.checkAndGetSessionAndWindowId(false, freshActivityAt + 40_000)
                tabA.persistence.flush()

                const result = tabB.manager.checkAndGetSessionAndWindowId(
                    false,
                    freshActivityAt + 40_000 + TIMEOUT_MS - 5_000
                )

                expect(result.sessionId).toBe('session-A')
            })
        })

        describe('sibling tab rotated to a new session and stays active', () => {
            const setupSiblingRotation = (): { tabA2: Tab; tabB: Tab; newSessionId: string; activeAt: number } => {
                const tabA = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tabA.manager.checkAndGetSessionAndWindowId(false, T0)
                tabA.persistence.flush()

                const tabB = makeTab({ sessionId: 'session-B', windowId: 'window-B' })
                tabB.manager.checkAndGetSessionAndWindowId(false, T0 + 100)
                tabB.persistence.flush()

                tabA.manager.resetSessionId()
                tabA.persistence.flush()
                const tabA2 = makeTab({ sessionId: 'session-A2', windowId: 'window-A2' })
                tabA2.manager.checkAndGetSessionAndWindowId(false, T0 + 1_000)
                tabA2.persistence.flush()

                const activeAt = T0 + 30_000
                tabA2.manager.checkAndGetSessionAndWindowId(false, activeAt)
                tabA2.persistence.flush()

                return { tabA2, tabB, newSessionId: 'session-A2', activeAt }
            }

            it('ACCEPT — tab B adopts the sibling new session id', () => {
                const { tabB, newSessionId, activeAt } = setupSiblingRotation()

                const result = tabB.manager.checkAndGetSessionAndWindowId(false, activeAt + TIMEOUT_MS - 5_000)
                tabB.persistence.flush()

                expect(result.sessionId).toBe(newSessionId)
                expect(storageSessionId()[1]).toBe(newSessionId)
            })

            it('ACCEPT — tab B keeps its own window id when adopting sibling session', () => {
                const { tabB, activeAt } = setupSiblingRotation()

                const result = tabB.manager.checkAndGetSessionAndWindowId(false, activeAt + TIMEOUT_MS - 5_000)

                expect(result.windowId).toBe('window-B')
            })

            it('fires onSessionId handlers with crossTabAdoption on the adopted rotation', () => {
                // Both paths ADOPT the sibling's new session id, so both must
                // fire handlers — a session id change that handlers don't hear
                // about leaves consumers (page-view state, a stopped recorder,
                // session-scoped props) on the old session.
                const { tabB, newSessionId, activeAt } = setupSiblingRotation()

                const handler = jest.fn()
                tabB.manager.onSessionId(handler)
                handler.mockClear()

                const result = tabB.manager.checkAndGetSessionAndWindowId(false, activeAt + TIMEOUT_MS - 5_000)

                expect(result.sessionId).toBe(newSessionId)
                expect(handler).toHaveBeenCalledWith(newSessionId, expect.any(String), {
                    noSessionId: false,
                    activityTimeout: false,
                    sessionPastMaximumLength: false,
                    crossTabAdoption: true,
                })
                expect(result.changeReason?.crossTabAdoption).toBe(true)
            })
        })

        describe('sibling tab rotated then went idle', () => {
            const setupSiblingRotatedThenIdle = () => {
                const tabA = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tabA.manager.checkAndGetSessionAndWindowId(false, T0)
                tabA.persistence.flush()

                const tabB = makeTab({ sessionId: 'session-B', windowId: 'window-B' })
                tabB.manager.checkAndGetSessionAndWindowId(false, T0 + 100)
                tabB.persistence.flush()

                tabA.manager.resetSessionId()
                tabA.persistence.flush()
                const rotationAt = T0 + 1_000
                const tabA2 = makeTab({ sessionId: 'session-A2', windowId: 'window-A2' })
                tabA2.manager.checkAndGetSessionAndWindowId(false, rotationAt)
                tabA2.persistence.flush()

                return { tabA2, tabB, rotationAt }
            }

            it('REJECT — tab B rotates rather than adopting a rotated-but-idle sibling session', () => {
                const { tabB, rotationAt } = setupSiblingRotatedThenIdle()

                const result = tabB.manager.checkAndGetSessionAndWindowId(false, rotationAt + TIMEOUT_MS + 5_000)

                expect(result.changeReason?.activityTimeout).toBe(true)
                expect(result.sessionId).not.toBe('session-A')
                expect(result.sessionId).not.toBe('session-A2')
            })
        })

        describe('sibling tab cleared the session (e.g. posthog.reset)', () => {
            const setupSiblingReset = () => {
                const tabA = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tabA.manager.checkAndGetSessionAndWindowId(false, T0)
                tabA.persistence.flush()

                const tabB = makeTab({ sessionId: 'session-B-fresh', windowId: 'window-B' })
                tabB.manager.checkAndGetSessionAndWindowId(false, T0 + 100)
                tabB.persistence.flush()

                tabA.manager.resetSessionId()
                tabA.persistence.flush()

                return { tabA, tabB }
            }

            it('REJECT — tab B does not extend a cleared session', () => {
                const { tabB } = setupSiblingReset()

                const result = tabB.manager.checkAndGetSessionAndWindowId(false, T0 + TIMEOUT_MS + 5_000)

                expect(result.sessionId).not.toBe('session-A')
                expect(result.sessionId).toBeTruthy()
            })
        })

        describe('session past maximum length', () => {
            // SESSION_LENGTH_LIMIT_MILLISECONDS is 24 hours. Past this, the
            // session must rotate regardless of sibling activity.
            it('REJECT — tab B rotates a 24h+ session even when sibling is keeping it alive', () => {
                const veryOldStart = T0
                const recentActivity = T0 + 24 * 60 * 60 * 1000 + 1_000

                const tabA = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tabA.manager.checkAndGetSessionAndWindowId(false, veryOldStart)
                tabA.persistence.flush()

                const tabB = makeTab({ sessionId: 'session-B', windowId: 'window-B' })
                tabB.manager.checkAndGetSessionAndWindowId(false, veryOldStart + 100)
                tabB.persistence.flush()

                tabA.manager.checkAndGetSessionAndWindowId(false, recentActivity)
                tabA.persistence.flush()

                const result = tabB.manager.checkAndGetSessionAndWindowId(false, recentActivity + 1_000)

                expect(result.changeReason?.sessionPastMaximumLength).toBe(true)
                expect(result.sessionId).not.toBe('session-A')
            })
        })

        describe('all tabs idle past the timeout', () => {
            it.each([
                ['without a pending register', false],
                ['with a pending non-session register', true],
            ])('tab B rotates locally when no tab has fresh activity %s', (_, withPending) => {
                const tabA = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tabA.manager.checkAndGetSessionAndWindowId(false, T0)
                tabA.persistence.flush()

                const tabB = makeTab({ sessionId: 'session-B-rotated', windowId: 'window-B' })
                tabB.manager.checkAndGetSessionAndWindowId(false, T0 + 100)
                tabB.persistence.flush()

                if (withPending) {
                    tabB.persistence.register({ custom_prop: 'tab-B-value' })
                }

                const result = tabB.manager.checkAndGetSessionAndWindowId(false, T0 + TIMEOUT_MS + 5_000)
                tabB.persistence.flush()

                expect(result.changeReason?.activityTimeout).toBe(true)
                expect(result.sessionId).toBe('session-B-rotated')
                if (withPending) {
                    expect(readStorage().custom_prop).toBe('tab-B-value')
                }
            })
        })

        describe('readOnly checkAndGet', () => {
            // readOnly is set when the call is not user-driven (background
            // operations, async polling). It must never rotate the session
            // and must not extend the activity timestamp.
            it('REJECT — readOnly past idle threshold does NOT rotate', () => {
                const tab = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tab.manager.checkAndGetSessionAndWindowId(false, T0)
                tab.persistence.flush()

                const result = tab.manager.checkAndGetSessionAndWindowId(true, T0 + TIMEOUT_MS + 5_000)

                expect(result.sessionId).toBe('session-A')
                expect(result.changeReason).toBeUndefined()
            })

            it('PRESERVE — readOnly preserves the existing activity timestamp', () => {
                const tab = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tab.manager.checkAndGetSessionAndWindowId(false, T0)
                tab.persistence.flush()

                const result = tab.manager.checkAndGetSessionAndWindowId(true, T0 + 5_000)

                expect(result.lastActivityTimestamp).toBe(T0)
            })
        })

        describe('onSessionId handlers', () => {
            it('fires on a local rotation', () => {
                const rotated = makeTab({ sessionId: 'session-A-new', windowId: 'window-A' })
                const handler = jest.fn()
                rotated.manager.onSessionId(handler)
                handler.mockClear()

                rotated.manager.checkAndGetSessionAndWindowId(false, T0 + TIMEOUT_MS + 5_000)

                expect(handler).toHaveBeenCalled()
            })

            it('does NOT fire on a same-session continuation', () => {
                const tab = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tab.manager.checkAndGetSessionAndWindowId(false, T0)

                const handler = jest.fn()
                tab.manager.onSessionId(handler)
                handler.mockClear()

                tab.manager.checkAndGetSessionAndWindowId(false, T0 + 1_000)

                expect(handler).not.toHaveBeenCalled()
            })
        })

        describe('interleaved cross-tab activity', () => {
            it('tab B in-memory activity from old session does NOT extend a sibling-rotated session', () => {
                const tabA = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tabA.manager.checkAndGetSessionAndWindowId(false, T0)
                tabA.persistence.flush()

                const tabB = makeTab({ sessionId: 'session-B', windowId: 'window-B' })
                tabB.manager.checkAndGetSessionAndWindowId(false, T0 + 200)
                tabB.persistence.flush()

                tabA.manager.resetSessionId()
                tabA.persistence.flush()
                const tabA2 = makeTab({ sessionId: 'session-A2', windowId: 'window-A2' })
                tabA2.manager.checkAndGetSessionAndWindowId(false, T0 + 1_000)
                tabA2.persistence.flush()
                tabA2.manager.checkAndGetSessionAndWindowId(false, T0 + 30_000)
                tabA2.persistence.flush()

                const result = tabB.manager.checkAndGetSessionAndWindowId(false, T0 + 30_000 + TIMEOUT_MS - 5_000)
                tabB.persistence.flush()

                expect(result.sessionId).toBe('session-A2')
                expect(storageSessionId()[1]).toBe('session-A2')
            })

            it('sibling activity arriving DURING tab B cross-tab refresh is still seen', () => {
                // In a real browser, a storage write between tab B's idle
                // check and its read of the on-disk session would land on
                // another tick. We simulate by writing from the sibling
                // inside the refresh method tab B actually uses for its
                // path, just before it reads from storage.
                const tabA = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tabA.manager.checkAndGetSessionAndWindowId(false, T0)
                tabA.persistence.flush()

                const tabB = makeTab({ sessionId: 'session-B', windowId: 'window-B' })
                tabB.manager.checkAndGetSessionAndWindowId(false, T0 + 100)
                tabB.persistence.flush()

                const siblingActivityAt = T0 + 30_000
                const refreshMethod = hardened ? 'refreshKey' : 'load'
                const original = (tabB.persistence[refreshMethod] as (...a: unknown[]) => unknown).bind(
                    tabB.persistence
                )
                const refreshSpy = jest
                    .spyOn(tabB.persistence, refreshMethod)
                    .mockImplementation((...args: unknown[]) => {
                        tabA.manager.checkAndGetSessionAndWindowId(false, siblingActivityAt)
                        tabA.persistence.flush()
                        return original(...args)
                    })

                const result = tabB.manager.checkAndGetSessionAndWindowId(false, T0 + TIMEOUT_MS + 5_000)

                expect(result.sessionId).toBe('session-A')
                refreshSpy.mockRestore()
            })
        })

        describe('known limitations (both paths)', () => {
            // The cross-tab merge limitations the per-key refresh does NOT
            // address — establish current behaviour so a future storage-events
            // implementation has a clear failure signal to flip.
            it.each([
                ['SESSION_ID', SESSION_ID],
                ['custom property', 'custom_prop'],
            ])('a tab B non-session register can overwrite a sibling write to %s via blob-replace', (_, key) => {
                const tabA = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tabA.manager.checkAndGetSessionAndWindowId(false, T0)
                tabA.persistence.register({ [key]: 'value-from-A' } as Properties)
                tabA.persistence.flush()

                const tabB = makeTab({ sessionId: 'session-B', windowId: 'window-B' })
                tabA.persistence.register({ [key]: 'updated-from-A' } as Properties)
                tabA.persistence.flush()

                tabB.persistence.register({ unrelated: 'tab-B-other-value' })
                tabB.persistence.flush()

                expect(readStorage()[key]).toBe('value-from-A')
            })

            it('an ACTIVE tab B does NOT observe a sibling rotation in real time', () => {
                // No storage-events listener. Tab B that is not past its own
                // idle threshold never refreshes from storage and thus never
                // sees the sibling rotation.
                const tabA = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
                tabA.manager.checkAndGetSessionAndWindowId(false, T0)
                tabA.persistence.flush()

                const tabB = makeTab({ sessionId: 'session-B', windowId: 'window-B' })
                tabB.manager.checkAndGetSessionAndWindowId(false, T0 + 100)
                tabB.persistence.flush()

                tabA.manager.resetSessionId()
                tabA.persistence.flush()
                const tabA2 = makeTab({ sessionId: 'session-A2', windowId: 'window-A2' })
                tabA2.manager.checkAndGetSessionAndWindowId(false, T0 + 1_000)
                tabA2.persistence.flush()

                const result = tabB.manager.checkAndGetSessionAndWindowId(false, T0 + 5_000)

                expect(result.sessionId).toBe('session-A')
            })
        })
    })

    describe('pending local writes survive cross-tab refresh — hardened path only (debounce=250)', () => {
        // With debounce enabled, a local register is held in memory until the
        // debounce window elapses. The per-key SESSION_ID refresh lets tab B
        // pick up a sibling's session WITHOUT first flushing its own stale
        // whole-props blob, so neither side clobbers the other.
        const makeTab = (opts: { sessionId?: string; windowId?: string } = {}): Tab =>
            buildTab(HARDENED_DEBOUNCE_MS, opts)

        const setupAliveSibling = (): { tabB: Tab; freshActivityAt: number } => {
            const tabA = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
            tabA.manager.checkAndGetSessionAndWindowId(false, T0)
            tabA.persistence.flush()

            const tabB = makeTab({ sessionId: 'session-B', windowId: 'window-B' })
            tabB.manager.checkAndGetSessionAndWindowId(false, T0 + 100)
            tabB.persistence.flush()

            const freshActivityAt = T0 + 30_000
            tabA.manager.checkAndGetSessionAndWindowId(false, freshActivityAt)
            tabA.persistence.flush()

            return { tabB, freshActivityAt }
        }

        it('ACCEPT — tab B keeps the sibling-alive session AND preserves its pending register', () => {
            const { tabB, freshActivityAt } = setupAliveSibling()
            tabB.persistence.register({ custom_prop: 'tab-B-value' })

            const result = tabB.manager.checkAndGetSessionAndWindowId(false, freshActivityAt + TIMEOUT_MS - 5_000)
            tabB.persistence.flush()

            expect(result.sessionId).toBe('session-A')
            expect(storageSessionId()[1]).toBe('session-A')
            expect(storageSessionId()[0]).toBeGreaterThanOrEqual(freshActivityAt)
            expect(readStorage().custom_prop).toBe('tab-B-value')
        })

        it('ACCEPT — tab B adopts a sibling rotation AND preserves its pending register', () => {
            const tabA = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
            tabA.manager.checkAndGetSessionAndWindowId(false, T0)
            tabA.persistence.flush()

            const tabB = makeTab({ sessionId: 'session-B', windowId: 'window-B' })
            tabB.manager.checkAndGetSessionAndWindowId(false, T0 + 100)
            tabB.persistence.flush()

            tabA.manager.resetSessionId()
            tabA.persistence.flush()
            const tabA2 = makeTab({ sessionId: 'session-A2', windowId: 'window-A2' })
            tabA2.manager.checkAndGetSessionAndWindowId(false, T0 + 1_000)
            tabA2.persistence.flush()
            const activeAt = T0 + 30_000
            tabA2.manager.checkAndGetSessionAndWindowId(false, activeAt)
            tabA2.persistence.flush()

            tabB.persistence.register({ custom_prop: 'tab-B-value' })

            const result = tabB.manager.checkAndGetSessionAndWindowId(false, activeAt + TIMEOUT_MS - 5_000)
            tabB.persistence.flush()

            expect(result.sessionId).toBe('session-A2')
            expect(storageSessionId()[1]).toBe('session-A2')
            expect(readStorage().custom_prop).toBe('tab-B-value')
        })

        it('multiple pending non-session registers all survive cross-tab refresh', () => {
            const { tabB, freshActivityAt } = setupAliveSibling()

            tabB.persistence.register({ prop_one: 'v1' })
            tabB.persistence.register({ prop_two: 'v2' })
            tabB.persistence.register({ prop_three: 'v3' })

            tabB.manager.checkAndGetSessionAndWindowId(false, freshActivityAt + TIMEOUT_MS - 5_000)
            tabB.persistence.flush()

            expect(readStorage().prop_one).toBe('v1')
            expect(readStorage().prop_two).toBe('v2')
            expect(readStorage().prop_three).toBe('v3')
            expect(storageSessionId()[1]).toBe('session-A')
        })

        it('KNOWN LIMITATION — a debounced register firing alone (no idle check) still clobbers sibling activity', () => {
            // Outside the idle-refresh path, a debounced flush writes the
            // whole props blob — there is no per-key merge for arbitrary
            // keys. Pinned so a future storage-level merge has a signal.
            const { tabB } = setupAliveSibling()

            tabB.persistence.register({ custom_prop: 'tab-B-value' })
            jest.advanceTimersByTime(HARDENED_DEBOUNCE_MS + 1)

            expect(storageSessionId()[0]).toBe(T0 + 100)
            expect(readStorage().custom_prop).toBe('tab-B-value')
        })
    })

    describe('pending local writes — legacy path limitation (debounce=0)', () => {
        // With debounce disabled, `register()` writes the whole props blob to
        // storage immediately. A local register issued while a sibling is
        // keeping the session alive overwrites the sibling's fresh activity
        // with tab B's stale view, and tab B then spuriously rotates on its
        // next idle check. This is the bug the hardened path fixes — pinned
        // here so the gating's value is explicit and not lost.
        const makeTab = (opts: { sessionId?: string; windowId?: string } = {}): Tab => buildTab(0, opts)

        it('KNOWN LIMITATION — a local register clobbers sibling activity and causes a spurious rotation', () => {
            const tabA = makeTab({ sessionId: 'session-A', windowId: 'window-A' })
            tabA.manager.checkAndGetSessionAndWindowId(false, T0)
            tabA.persistence.flush()

            const tabB = makeTab({ sessionId: 'session-B-rotated', windowId: 'window-B' })
            tabB.manager.checkAndGetSessionAndWindowId(false, T0 + 100)
            tabB.persistence.flush()

            const freshActivityAt = T0 + 30_000
            tabA.manager.checkAndGetSessionAndWindowId(false, freshActivityAt)
            tabA.persistence.flush()

            // Immediate write clobbers the sibling's fresh activity in storage.
            tabB.persistence.register({ custom_prop: 'tab-B-value' })

            const result = tabB.manager.checkAndGetSessionAndWindowId(false, freshActivityAt + TIMEOUT_MS - 5_000)

            // The sibling was alive, but tab B rotates anyway because it
            // clobbered then re-read its own stale view.
            expect(result.changeReason?.activityTimeout).toBe(true)
            expect(result.sessionId).toBe('session-B-rotated')
        })
    })
})

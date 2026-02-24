import { posthogZustandTracker } from '../../customizations/posthogZustandLogger'
import type { PostHogStateLogger, StateEvent } from '../../customizations/posthogReduxLogger'

// Minimal Zustand-like store for testing (no zustand dependency needed)
function createMockStore<S>(initialState: S) {
    let state = initialState
    return {
        getState: () => state,
        setState: (partial: Partial<S> | ((s: S) => Partial<S>)) => {
            const update = typeof partial === 'function' ? partial(state) : partial
            state = { ...state, ...update }
        },
    }
}

function createMockLogger(): { logger: PostHogStateLogger; calls: Array<{ title: string; stateEvent: StateEvent }> } {
    const calls: Array<{ title: string; stateEvent: StateEvent }> = []
    const logger: PostHogStateLogger = (title, stateEvent) => {
        calls.push({ title, stateEvent })
    }
    return { logger, calls }
}

describe('posthogZustandTracker', () => {
    describe('basic tracking', () => {
        test('captures prevState, nextState, and changedState for a sync action', () => {
            const store = createMockStore({ count: 0, name: 'test' })
            const { logger, calls } = createMockLogger()

            const track = posthogZustandTracker({ store, logger })

            track('increment', () => store.setState({ count: 1 }))

            expect(calls).toHaveLength(1)
            expect(calls[0].stateEvent.type).toBe('increment')
            expect(calls[0].stateEvent.prevState).toEqual({ count: 0, name: 'test' })
            expect(calls[0].stateEvent.changedState).toEqual({ count: 1 })
            // nextState excluded by default
            expect(calls[0].stateEvent.nextState).toBeUndefined()
        })

        test('returns the result of the action function', () => {
            const store = createMockStore({ count: 0 })
            const { logger } = createMockLogger()

            const track = posthogZustandTracker({ store, logger })

            const result = track('getValue', () => {
                store.setState({ count: 42 })
                return 'hello'
            })

            expect(result).toBe('hello')
        })

        test('action name appears in title', () => {
            const store = createMockStore({ count: 0 })
            const { logger, calls } = createMockLogger()

            const track = posthogZustandTracker({ store, logger })

            track('myAction', () => store.setState({ count: 1 }))

            expect(calls[0].title).toMatch(/^myAction/)
        })

        test('includes executionTimeMs', () => {
            const store = createMockStore({ count: 0 })
            const { logger, calls } = createMockLogger()

            const track = posthogZustandTracker({ store, logger })

            track('increment', () => store.setState({ count: 1 }))

            expect(calls[0].stateEvent.executionTimeMs).toBeGreaterThanOrEqual(0)
        })

        test('includes timestamp', () => {
            const store = createMockStore({ count: 0 })
            const { logger, calls } = createMockLogger()

            const track = posthogZustandTracker({ store, logger })

            const before = Date.now()
            track('increment', () => store.setState({ count: 1 }))
            const after = Date.now()

            expect(calls[0].stateEvent.timestamp).toBeGreaterThanOrEqual(before)
            expect(calls[0].stateEvent.timestamp).toBeLessThanOrEqual(after)
        })
    })

    describe('async actions', () => {
        test('captures state after async action resolves', async () => {
            const store = createMockStore({ loading: false, data: null as string | null })
            const { logger, calls } = createMockLogger()

            const track = posthogZustandTracker({ store, logger })

            await track('fetchData', async () => {
                store.setState({ loading: true })
                await new Promise((resolve) => setTimeout(resolve, 10))
                store.setState({ loading: false, data: 'fetched' })
            })

            expect(calls).toHaveLength(1)
            expect(calls[0].stateEvent.type).toBe('fetchData')
            expect(calls[0].stateEvent.prevState).toEqual({ loading: false, data: null })
            // loading starts false and ends false — not in the diff. Only data changed.
            expect(calls[0].stateEvent.changedState).toEqual({ data: 'fetched' })
        })

        test('returns the resolved value of async action', async () => {
            const store = createMockStore({ count: 0 })
            const { logger } = createMockLogger()

            const track = posthogZustandTracker({ store, logger })

            const result = await track('asyncAction', async () => {
                store.setState({ count: 1 })
                return 'async result'
            })

            expect(result).toBe('async result')
        })

        test('executionTimeMs reflects async duration', async () => {
            const store = createMockStore({ count: 0 })
            const { logger, calls } = createMockLogger()

            const track = posthogZustandTracker({ store, logger })

            await track('slowAction', async () => {
                await new Promise((resolve) => setTimeout(resolve, 50))
                store.setState({ count: 1 })
            })

            expect(calls[0].stateEvent.executionTimeMs).toBeGreaterThanOrEqual(40)
        })
    })

    describe('maskState', () => {
        test('applies maskState to prevState and nextState before diffing', () => {
            const store = createMockStore({ count: 0, secret: 'password123' })
            const { logger, calls } = createMockLogger()

            const track = posthogZustandTracker({
                store,
                logger,
                maskState: (state) => ({ ...state, secret: '***' }),
            })

            track('increment', () => store.setState({ count: 1 }))

            expect(calls[0].stateEvent.prevState.secret).toBe('***')
            // changedState should not include secret since masked value didn't change
            expect(calls[0].stateEvent.changedState).toEqual({ count: 1 })
        })

        test('skips masking when maskState is undefined', () => {
            const store = createMockStore({ count: 0, secret: 'password123' })
            const { logger, calls } = createMockLogger()

            const track = posthogZustandTracker({ store, logger })

            track('increment', () => store.setState({ count: 1 }))

            expect(calls[0].stateEvent.prevState.secret).toBe('password123')
        })
    })

    describe('include options', () => {
        test('includes nextState when configured', () => {
            const store = createMockStore({ count: 0 })
            const { logger, calls } = createMockLogger()

            const track = posthogZustandTracker({
                store,
                logger,
                include: { prevState: true, nextState: true, changedState: true },
            })

            track('increment', () => store.setState({ count: 1 }))

            expect(calls[0].stateEvent.nextState).toEqual({ count: 1 })
        })

        test('excludes prevState when configured', () => {
            const store = createMockStore({ count: 0 })
            const { logger, calls } = createMockLogger()

            const track = posthogZustandTracker({
                store,
                logger,
                include: { prevState: false, nextState: false, changedState: true },
            })

            track('increment', () => store.setState({ count: 1 }))

            expect(calls[0].stateEvent.prevState).toBeUndefined()
            expect(calls[0].stateEvent.nextState).toBeUndefined()
            expect(calls[0].stateEvent.changedState).toEqual({ count: 1 })
        })

        test('excludes changedState when configured', () => {
            const store = createMockStore({ count: 0 })
            const { logger, calls } = createMockLogger()

            const track = posthogZustandTracker({
                store,
                logger,
                include: { prevState: false, nextState: false, changedState: false },
            })

            track('increment', () => store.setState({ count: 1 }))

            expect(calls[0].stateEvent.prevState).toBeUndefined()
            expect(calls[0].stateEvent.nextState).toBeUndefined()
            expect(calls[0].stateEvent.changedState).toBeUndefined()
        })
    })

    describe('rate limiting', () => {
        test('allows burst of actions up to bucket size', () => {
            const store = createMockStore({ count: 0 })
            const { logger, calls } = createMockLogger()

            const track = posthogZustandTracker({
                store,
                logger,
                rateLimiterBucketSize: 3,
            })

            for (let i = 0; i < 5; i++) {
                track('increment', () => store.setState({ count: i }))
            }

            // Bucket size 3: first 2 get through, 3rd consumes last token and is rate limited
            expect(calls).toHaveLength(2)
        })

        test('rate limits by action name independently', () => {
            const store = createMockStore({ count: 0, name: 'test' })
            const { logger, calls } = createMockLogger()

            const track = posthogZustandTracker({
                store,
                logger,
                rateLimiterBucketSize: 3,
            })

            for (let i = 0; i < 4; i++) {
                track('actionA', () => store.setState({ count: i }))
            }
            for (let i = 0; i < 4; i++) {
                track('actionB', () => store.setState({ name: `name${i}` }))
            }

            const actionACalls = calls.filter((c) => c.stateEvent.type === 'actionA')
            const actionBCalls = calls.filter((c) => c.stateEvent.type === 'actionB')

            // Each action type gets its own bucket (size 3 = 2 get through)
            expect(actionACalls).toHaveLength(2)
            expect(actionBCalls).toHaveLength(2)
        })
    })

    describe('custom titleFunction', () => {
        test('uses custom title function when provided', () => {
            const store = createMockStore({ count: 0 })
            const { logger, calls } = createMockLogger()

            const track = posthogZustandTracker({
                store,
                logger,
                titleFunction: (stateEvent) => `[ZUSTAND] ${stateEvent.type}`,
            })

            track('increment', () => store.setState({ count: 1 }))

            expect(calls[0].title).toBe('[ZUSTAND] increment')
        })
    })

    describe('multiple stores', () => {
        test('separate trackers work independently', () => {
            const storeA = createMockStore({ countA: 0 })
            const storeB = createMockStore({ countB: 0 })
            const { logger, calls } = createMockLogger()

            const trackA = posthogZustandTracker({ store: storeA, logger })
            const trackB = posthogZustandTracker({ store: storeB, logger })

            trackA('incrementA', () => storeA.setState({ countA: 1 }))
            trackB('incrementB', () => storeB.setState({ countB: 1 }))

            expect(calls).toHaveLength(2)
            expect(calls[0].stateEvent.type).toBe('incrementA')
            expect(calls[0].stateEvent.prevState).toEqual({ countA: 0 })
            expect(calls[1].stateEvent.type).toBe('incrementB')
            expect(calls[1].stateEvent.prevState).toEqual({ countB: 0 })
        })
    })

    describe('error handling', () => {
        test('does not throw when logger throws', () => {
            const store = createMockStore({ count: 0 })
            const throwingLogger: PostHogStateLogger = () => {
                throw new Error('logger exploded')
            }

            const track = posthogZustandTracker({ store, logger: throwingLogger })

            // Should not throw
            expect(() => {
                track('increment', () => store.setState({ count: 1 }))
            }).not.toThrow()
        })

        test('does not throw when maskState throws', () => {
            const store = createMockStore({ count: 0 })
            const { logger } = createMockLogger()

            const track = posthogZustandTracker({
                store,
                logger,
                maskState: () => {
                    throw new Error('mask exploded')
                },
            })

            expect(() => {
                track('increment', () => store.setState({ count: 1 }))
            }).not.toThrow()
        })
    })

    describe('state diffing depth', () => {
        test('respects __stateComparisonDepth', () => {
            const store = createMockStore({
                l1: { l2: { l3: { l4: { deep: 'old' } } } },
            })
            const { logger, calls } = createMockLogger()

            const track = posthogZustandTracker({
                store,
                logger,
                __stateComparisonDepth: 2,
            })

            track('deepChange', () =>
                store.setState({
                    l1: { l2: { l3: { l4: { deep: 'new' } } } },
                })
            )

            // At depth 2, l3 should hit max depth
            expect(calls[0].stateEvent.changedState).toBeDefined()
        })
    })
})

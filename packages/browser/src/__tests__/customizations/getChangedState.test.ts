import { getChangedState } from '../../customizations/posthogReduxLogger'

// Helper function to create complex nested state objects
function createComplexState(depth: number, breadth: number, includeArrays = false): Record<string, any> {
    const state: Record<string, any> = {}

    for (let i = 0; i < breadth; i++) {
        const key = `key_${i}`

        if (depth > 0) {
            // Create nested objects
            state[key] = createComplexState(depth - 1, breadth, includeArrays)
        } else {
            // Create leaf values
            if (includeArrays && i % 3 === 0) {
                state[key] = new Array(10).fill(0).map((_, idx) => ({ id: idx, value: `item_${idx}` }))
            } else if (i % 2 === 0) {
                state[key] = `value_${i}_${Math.random().toString(36).substr(2, 9)}`
            } else {
                state[key] = Math.floor(Math.random() * 1000)
            }
        }
    }

    return state
}

// Helper function to modify state in a realistic way (simulating UI drag operations)
function modifyStateForDrag(state: Record<string, any>, modifications: number = 5): Record<string, any> {
    const newState = JSON.parse(JSON.stringify(state))

    // Simulate drag-related state changes
    for (let i = 0; i < modifications; i++) {
        const key = `drag_operation_${i}`
        newState[key] = {
            isDragging: true,
            dragStartTime: Date.now(),
            dragPosition: { x: Math.random() * 1000, y: Math.random() * 1000 },
            dragElement: `element_${i}`,
            dragData: new Array(20).fill(0).map((_, idx) => ({
                id: idx,
                position: { x: idx * 10, y: idx * 10 },
                metadata: { type: 'draggable', visible: true },
            })),
        }
    }

    // Modify some existing deep properties
    if (newState.key_0 && typeof newState.key_0 === 'object') {
        Object.keys(newState.key_0).forEach((key, idx) => {
            if (idx < modifications) {
                if (typeof newState.key_0[key] === 'object') {
                    newState.key_0[key] = { ...newState.key_0[key], modified: true, timestamp: Date.now() }
                }
            }
        })
    }

    return newState
}

// Helper functions for timing measurements
function measureExecutionTime<T>(fn: () => T): { result: T; executionTime: number } {
    const startTime = performance.now()
    const result = fn()
    const endTime = performance.now()
    return { result, executionTime: endTime - startTime }
}

function measureMultipleExecutions<T>(
    fn: () => T,
    iterations: number = 10
): { result: T; avgTime: number; medianTime: number; stdDev: number; times: number[] } {
    const times: number[] = []
    let lastResult: T

    for (let i = 0; i < iterations; i++) {
        const { result, executionTime } = measureExecutionTime(fn)
        times.push(executionTime)
        lastResult = result
    }

    const avgTime = times.reduce((a, b) => a + b) / times.length

    const sortedTimes = [...times].sort((a, b) => a - b)
    const mid = Math.floor(sortedTimes.length / 2)
    const medianTime = sortedTimes.length % 2 === 0 ? (sortedTimes[mid - 1] + sortedTimes[mid]) / 2 : sortedTimes[mid]

    const variance = times.reduce((sum, time) => sum + Math.pow(time - avgTime, 2), 0) / times.length
    const stdDev = Math.sqrt(variance)

    return { result: lastResult!, avgTime, medianTime, stdDev, times }
}

describe('getChangedState', () => {
    describe('performance tests', () => {
        test('should handle realistic UI state efficiently', () => {
            // Fixed test data representing realistic UI state
            const prevState = {
                ui: {
                    modal: { isOpen: false, content: null },
                    sidebar: { collapsed: false, activeTab: 'files' },
                    editor: {
                        content: 'hello world',
                        cursor: { line: 1, column: 5 },
                        selection: null,
                    },
                },
                data: {
                    files: [
                        { id: 1, name: 'file1.js', modified: false },
                        { id: 2, name: 'file2.js', modified: false },
                    ],
                    user: { id: 123, name: 'John', preferences: { theme: 'dark' } },
                },
            }

            const nextState = {
                ...prevState,
                ui: {
                    ...prevState.ui,
                    modal: { isOpen: true, content: 'Save changes?' },
                    editor: {
                        ...prevState.ui.editor,
                        cursor: { line: 1, column: 11 },
                        selection: { start: 6, end: 11 },
                    },
                },
            }

            const { executionTime } = measureExecutionTime(() => getChangedState(prevState, nextState))

            expect(executionTime).toBeLessThan(10)
        })

        test('should handle medium complexity state objects', () => {
            const prevState = createComplexState(3, 8, true)
            const nextState = modifyStateForDrag(prevState, 5)

            const { executionTime } = measureExecutionTime(() => getChangedState(prevState, nextState, 10))

            expect(executionTime).toBeLessThan(45)
        })

        test('should handle large complex state objects (stress test)', () => {
            const prevState = createComplexState(4, 10, true)
            const nextState = modifyStateForDrag(prevState, 8)

            const { avgTime, medianTime, stdDev } = measureMultipleExecutions(() =>
                getChangedState(prevState, nextState, 5)
            )

            // these run much slower in CI than on my machine
            expect(medianTime).toBeLessThan(100)
            expect(avgTime).toBeLessThan(200)
            expect(stdDev).toBeLessThan(100)
        })

        test('should handle complex state changes efficiently', () => {
            // Fixed complex state - easier to understand what we're testing
            const prevState = {
                app: {
                    user: { id: 1, name: 'John', settings: { theme: 'dark', lang: 'en' } },
                    data: {
                        items: [
                            { id: 1, text: 'Item 1' },
                            { id: 2, text: 'Item 2' },
                        ],
                        filters: { active: true, category: 'all' },
                    },
                },
                ui: {
                    modal: { open: false, type: null },
                    notifications: { count: 0, items: [] },
                },
            }

            const nextState = {
                ...prevState,
                app: {
                    ...prevState.app,
                    user: { ...prevState.app.user, name: 'Jane' },
                    data: {
                        ...prevState.app.data,
                        items: [...prevState.app.data.items, { id: 3, text: 'Item 3' }],
                        filters: { ...prevState.app.data.filters, category: 'active' },
                    },
                },
                ui: {
                    ...prevState.ui,
                    modal: { open: true, type: 'confirm' },
                },
            }

            const { avgTime, medianTime, stdDev } = measureMultipleExecutions(() =>
                getChangedState(prevState, nextState)
            )

            expect(medianTime).toBeLessThan(10)
            expect(avgTime).toBeLessThan(15)
            expect(stdDev).toBeLessThan(10)
        })

        test('should handle identical states efficiently', () => {
            const state = createComplexState(4, 8, true)

            const startTime = performance.now()
            const result = getChangedState(state, state)
            const endTime = performance.now()

            const executionTime = endTime - startTime

            // Should be very fast for identical states
            expect(executionTime).toBeLessThan(5)
            expect(result).toEqual({})
        })
    })

    describe('correctness tests', () => {
        test.each([
            {
                name: 'identical states',
                prevState: { a: 1, b: { c: 2 } },
                nextState: { a: 1, b: { c: 2 } },
            },
            {
                name: 'null and undefined values',
                prevState: { a: null, b: undefined, c: 'value' },
                nextState: { a: 'changed', b: 'defined', c: null },
            },
            {
                name: 'added keys',
                prevState: { a: 1, b: 2 },
                nextState: { a: 1, b: 2, c: 3 },
            },
            {
                name: 'removed keys',
                prevState: { a: 1, b: 2, c: 3 },
                nextState: { a: 1, b: 2 },
            },
            {
                name: 'changed keys',
                prevState: { a: 1, b: 2, c: 3 },
                nextState: { a: 1, b: 5, c: 3 },
            },
            {
                name: 'arrays as primitive values',
                prevState: {
                    list: [1, 2, 3],
                    obj: { a: 1 },
                },
                nextState: {
                    list: [1, 2, 3, 4],
                    obj: { a: 1 },
                },
            },
            {
                name: 'nested object changes',
                prevState: {
                    user: { name: 'John', age: 30 },
                    settings: { theme: 'dark', notifications: { email: true } },
                },
                nextState: {
                    user: { name: 'John', age: 31 },
                    settings: { theme: 'light', notifications: { email: true } },
                },
            },
            {
                name: 'deeply nested changes within depth limit',
                prevState: {
                    level1: {
                        level2: {
                            level3: {
                                value: 'old',
                            },
                        },
                    },
                },
                nextState: {
                    level1: {
                        level2: {
                            level3: {
                                value: 'new',
                            },
                        },
                    },
                },
            },
            {
                name: 'depth limit respected',
                prevState: {
                    l1: { l2: { l3: { l4: { l5: { l6: 'old' } } } } },
                },
                nextState: {
                    l1: { l2: { l3: { l4: { l5: { l6: 'new' } } } } },
                },
                maxDepth: 2,
            },
            {
                name: 'mixed data types',
                prevState: {
                    string: 'hello',
                    number: 42,
                    boolean: true,
                    array: [1, 2, 3],
                    object: { nested: 'value' },
                    nullValue: null,
                    undefinedValue: undefined,
                },
                nextState: {
                    string: 'world',
                    number: 42,
                    boolean: false,
                    array: [4, 5, 6],
                    object: { nested: 'changed' },
                    nullValue: 'not null',
                    undefinedValue: 'defined',
                },
            },
            {
                name: 'empty objects',
                prevState: {},
                nextState: { a: 1 },
            },
            {
                name: 'string vs object (non-object input)',
                prevState: 'string' as any,
                nextState: { a: 1 },
            },
            {
                name: 'object vs null (non-object input)',
                prevState: { a: 1 },
                nextState: null as any,
            },
            {
                name: 'number vs boolean (non-object input)',
                prevState: 42 as any,
                nextState: true as any,
            },
            {
                name: 'Redux-style state changes',
                prevState: {
                    todos: [
                        { id: 1, text: 'Learn React', completed: false },
                        { id: 2, text: 'Learn Redux', completed: true },
                    ],
                    visibilityFilter: 'SHOW_ALL',
                    user: {
                        id: 123,
                        name: 'John',
                        profile: { avatar: 'old.jpg', theme: 'dark' },
                    },
                },
                nextState: {
                    todos: [
                        { id: 1, text: 'Learn React', completed: true },
                        { id: 2, text: 'Learn Redux', completed: true },
                        { id: 3, text: 'Learn Testing', completed: false },
                    ],
                    visibilityFilter: 'SHOW_COMPLETED',
                    user: {
                        id: 123,
                        name: 'John',
                        profile: { avatar: 'new.jpg', theme: 'dark' },
                    },
                },
            },
        ])('should handle $name', ({ prevState, nextState, maxDepth }) => {
            const result = getChangedState(prevState, nextState, maxDepth)
            expect(result).toMatchSnapshot()
        })
    })
})

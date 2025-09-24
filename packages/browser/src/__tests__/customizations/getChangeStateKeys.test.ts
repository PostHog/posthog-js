import { getChangedStateKeys } from '../../customizations/posthogReduxLogger'

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

describe('getChangeStateKeys', () => {
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

            const startTime = performance.now()
            const result = getChangedStateKeys(prevState, nextState)
            const endTime = performance.now()

            const executionTime = endTime - startTime

            // Performance assertion - should complete within 5ms for realistic UI state
            expect(executionTime).toBeLessThan(5)

            // Correctness assertions - should detect UI changes
            expect(result.nextState).toHaveProperty('ui')
            expect(result.nextState.ui).toHaveProperty('modal')
            expect(result.nextState.ui).toHaveProperty('editor')

            console.log(`Realistic UI state diff took: ${executionTime.toFixed(2)}ms`)
        })

        test('should handle medium complexity state objects', () => {
            const prevState = createComplexState(3, 8, true)
            const nextState = modifyStateForDrag(prevState, 5)

            const startTime = performance.now()
            const result = getChangedStateKeys(prevState, nextState)
            const endTime = performance.now()

            const executionTime = endTime - startTime

            expect(executionTime).toBeLessThan(30)

            // Correctness assertions
            expect(result.nextState).toBeDefined()
            expect(Object.keys(result.nextState || {})).toEqual(
                expect.arrayContaining(['drag_operation_0', 'drag_operation_1', 'drag_operation_2'])
            )

            console.log(`Medium state diff took: ${executionTime.toFixed(2)}ms`)
        })

        test('should handle large complex state objects (stress test)', () => {
            const prevState = createComplexState(4, 10, true)
            const nextState = modifyStateForDrag(prevState, 8)

            const startTime = performance.now()
            const result = getChangedStateKeys(prevState, nextState)
            const endTime = performance.now()

            const executionTime = endTime - startTime

            // Performance assertion - should complete quickly even for large objects
            // This is the threshold where UI lag would become noticeable during drag operations
            expect(executionTime).toBeLessThan(30)

            // Correctness assertions
            expect(result.nextState).toBeDefined()
            expect(Object.keys(result.nextState || {}).length).toBeGreaterThan(5)

            console.log(`Large state diff took: ${executionTime.toFixed(2)}ms`)
            console.log(`State size: ~${JSON.stringify(prevState).length} characters`)
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

            // Test performance with multiple runs
            const iterations = 10
            const times: number[] = []

            for (let i = 0; i < iterations; i++) {
                const startTime = performance.now()
                const result = getChangedStateKeys(prevState, nextState)
                const endTime = performance.now()
                times.push(endTime - startTime)

                // Verify correctness on first run
                if (i === 0) {
                    expect(result.nextState).toHaveProperty('app')
                    expect(result.nextState).toHaveProperty('ui')
                    expect(result.nextState.app).toHaveProperty('user')
                    expect(result.nextState.app).toHaveProperty('data')
                }
            }

            const avgTime = times.reduce((a, b) => a + b) / times.length
            const maxTime = Math.max(...times)

            // Should be fast for realistic complex state
            expect(avgTime).toBeLessThan(10)
            expect(maxTime).toBeLessThan(20)

            console.log(`Complex state diff - Avg: ${avgTime.toFixed(2)}ms, Max: ${maxTime.toFixed(2)}ms`)
        })

        test('should handle identical states efficiently', () => {
            const state = createComplexState(4, 8, true)

            const startTime = performance.now()
            const result = getChangedStateKeys(state, state)
            const endTime = performance.now()

            const executionTime = endTime - startTime

            // Should be very fast for identical states
            expect(executionTime).toBeLessThan(1)
            expect(result.prevState).toEqual({})
            expect(result.nextState).toEqual({})

            console.log(`Identical state diff took: ${executionTime.toFixed(2)}ms`)
        })
    })

    describe('correctness tests', () => {
        test('should return empty objects for identical states', () => {
            const state = { a: 1, b: { c: 2 } }
            const result = getChangedStateKeys(state, state)

            expect(result.prevState).toEqual({})
            expect(result.nextState).toEqual({})
        })

        test('should handle null and undefined values', () => {
            const prevState = { a: null, b: undefined, c: 'value' }
            const nextState = { a: 'changed', b: 'defined', c: null }

            const result = getChangedStateKeys(prevState, nextState)

            expect(result.prevState).toEqual({ a: null, b: undefined, c: 'value' })
            expect(result.nextState).toEqual({ a: 'changed', b: 'defined', c: null })
        })

        test('should correctly identify added keys', () => {
            const prevState = { a: 1, b: 2 }
            const nextState = { a: 1, b: 2, c: 3 }

            const result = getChangedStateKeys(prevState, nextState)

            expect(result.nextState).toEqual({ c: 3 })
            expect(result.prevState).toEqual({})
        })

        test('should correctly identify removed keys', () => {
            const prevState = { a: 1, b: 2, c: 3 }
            const nextState = { a: 1, b: 2 }

            const result = getChangedStateKeys(prevState, nextState)

            expect(result.prevState).toEqual({ c: 3 })
            expect(result.nextState).toEqual({})
        })

        test('should correctly identify changed keys', () => {
            const prevState = { a: 1, b: 2, c: 3 }
            const nextState = { a: 1, b: 5, c: 3 }

            const result = getChangedStateKeys(prevState, nextState)

            expect(result.prevState).toEqual({ b: 2 })
            expect(result.nextState).toEqual({ b: 5 })
        })

        test('should handle arrays as primitive values', () => {
            const prevState = {
                list: [1, 2, 3],
                obj: { a: 1 },
            }
            const nextState = {
                list: [1, 2, 3, 4],
                obj: { a: 1 },
            }

            const result = getChangedStateKeys(prevState, nextState)

            expect(result.prevState).toEqual({ list: [1, 2, 3] })
            expect(result.nextState).toEqual({ list: [1, 2, 3, 4] })
        })

        test('should handle nested object changes', () => {
            const prevState = {
                user: { name: 'John', age: 30 },
                settings: { theme: 'dark', notifications: { email: true } },
            }
            const nextState = {
                user: { name: 'John', age: 31 },
                settings: { theme: 'light', notifications: { email: true } },
            }

            const result = getChangedStateKeys(prevState, nextState)

            expect(result.prevState).toEqual({
                user: { age: 30 },
                settings: { theme: 'dark' },
            })
            expect(result.nextState).toEqual({
                user: { age: 31 },
                settings: { theme: 'light' },
            })
        })

        test('should handle deeply nested changes within depth limit', () => {
            const prevState = {
                level1: {
                    level2: {
                        level3: {
                            value: 'old',
                        },
                    },
                },
            }
            const nextState = {
                level1: {
                    level2: {
                        level3: {
                            value: 'new',
                        },
                    },
                },
            }

            const result = getChangedStateKeys(prevState, nextState)

            expect(result.prevState).toEqual({
                level1: {
                    level2: {
                        level3: { value: 'old' },
                    },
                },
            })
            expect(result.nextState).toEqual({
                level1: {
                    level2: {
                        level3: { value: 'new' },
                    },
                },
            })
        })

        test('should respect depth limit', () => {
            const prevState = {
                l1: { l2: { l3: { l4: { l5: 'old' } } } },
            }
            const nextState = {
                l1: { l2: { l3: { l4: { l5: 'new' } } } },
            }

            // With default maxDepth=3, should stop at level 3
            const result = getChangedStateKeys(prevState, nextState, 2)

            expect(result.prevState).toEqual({
                l1: { l2: { l3: { l4: { l5: 'old' } } } },
            })
            expect(result.nextState).toEqual({
                l1: { l2: { l3: { l4: { l5: 'new' } } } },
            })
        })

        test('should handle mixed data types', () => {
            const prevState = {
                string: 'hello',
                number: 42,
                boolean: true,
                array: [1, 2, 3],
                object: { nested: 'value' },
                nullValue: null,
                undefinedValue: undefined,
            }
            const nextState = {
                string: 'world',
                number: 42,
                boolean: false,
                array: [4, 5, 6],
                object: { nested: 'changed' },
                nullValue: 'not null',
                undefinedValue: 'defined',
            }

            const result = getChangedStateKeys(prevState, nextState)

            expect(result.prevState).toEqual({
                string: 'hello',
                boolean: true,
                array: [1, 2, 3],
                object: { nested: 'value' },
                nullValue: null,
                undefinedValue: undefined,
            })
            expect(result.nextState).toEqual({
                string: 'world',
                boolean: false,
                array: [4, 5, 6],
                object: { nested: 'changed' },
                nullValue: 'not null',
                undefinedValue: 'defined',
            })
        })

        test('should handle edge case - empty objects', () => {
            const prevState = {}
            const nextState = { a: 1 }

            const result = getChangedStateKeys(prevState, nextState)

            expect(result.prevState).toEqual({})
            expect(result.nextState).toEqual({ a: 1 })
        })

        test('should handle edge case - non-object inputs', () => {
            const result1 = getChangedStateKeys('string', { a: 1 })
            const result2 = getChangedStateKeys({ a: 1 }, null)
            const result3 = getChangedStateKeys(42, true)

            expect(result1).toEqual({})
            expect(result2).toEqual({ prevState: { a: 1 }, nextState: null })
            expect(result3).toEqual({})
        })

        test('should handle Redux-style state changes', () => {
            // Simulate a typical Redux state change
            const prevState = {
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
            }

            const nextState = {
                todos: [
                    { id: 1, text: 'Learn React', completed: true }, // completed changed
                    { id: 2, text: 'Learn Redux', completed: true },
                    { id: 3, text: 'Learn Testing', completed: false }, // new todo added
                ],
                visibilityFilter: 'SHOW_COMPLETED', // filter changed
                user: {
                    id: 123,
                    name: 'John',
                    profile: { avatar: 'new.jpg', theme: 'dark' }, // avatar changed
                },
            }

            const result = getChangedStateKeys(prevState, nextState)

            // Should detect array changes as primitive (entire array replaced)
            expect(result.prevState).toHaveProperty('todos')
            expect(result.nextState).toHaveProperty('todos')
            expect(result.prevState).toHaveProperty('visibilityFilter', 'SHOW_ALL')
            expect(result.nextState).toHaveProperty('visibilityFilter', 'SHOW_COMPLETED')
            expect(result.prevState.user).toHaveProperty('profile')
            expect(result.nextState.user).toHaveProperty('profile')
            expect(result.nextState.user.profile).toHaveProperty('avatar', 'new.jpg')
        })
    })
})

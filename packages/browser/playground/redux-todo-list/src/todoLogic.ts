import { kea, path, actions, reducers, selectors } from 'kea'

export interface Todo {
    id: number
    text: string
    completed: boolean
}

export type FilterType = 'all' | 'active' | 'completed'

export interface TodoLogicType {
    todos: Todo[]
    filter: FilterType
    user: {
        name: string
        email: string
        preferences: {
            theme: 'light' | 'dark'
            notifications: boolean
        }
    }
    ui: {
        isLoading: boolean
        error: string | null
        showCompleted: boolean
    }
    stats: {
        totalTodos: number
        completedTodos: number
        todayCount: number
    }
}

export const todoLogic = kea<TodoLogicType>([
    path(['todo']),

    actions({
        addTodo: (text: string) => ({ text }),
        toggleTodo: (id: number) => ({ id }),
        deleteTodo: (id: number) => ({ id }),
        setFilter: (filter: FilterType) => ({ filter }),
        clearCompleted: true,
        setUserName: (name: string) => ({ name }),
        setTheme: (theme: 'light' | 'dark') => ({ theme }),
        toggleNotifications: true,
        setLoading: (isLoading: boolean) => ({ isLoading }),
        setError: (error: string | null) => ({ error }),
        toggleShowCompleted: true,
        updateStats: true,
    }),

    reducers({
        todos: [
            [
                { id: 1, text: 'Learn Kea with TypeScript', completed: false },
                { id: 2, text: 'Build a todo app with Kea', completed: false },
                { id: 3, text: 'Test with PostHog Kea Logger', completed: false },
            ] as Todo[],
            {
                addTodo: (state, { text }) => [
                    ...state,
                    {
                        id: Date.now(),
                        text,
                        completed: false,
                    },
                ],
                toggleTodo: (state, { id }) =>
                    state.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo)),
                deleteTodo: (state, { id }) => state.filter((todo) => todo.id !== id),
                clearCompleted: (state) => state.filter((todo) => !todo.completed),
            },
        ],

        filter: [
            'all' as FilterType,
            {
                setFilter: (_, { filter }) => filter,
            },
        ],

        user: [
            {
                name: 'Kea Demo User',
                email: 'kea-demo@example.com',
                preferences: {
                    theme: 'light' as const,
                    notifications: true,
                },
            },
            {
                setUserName: (state, { name }) => ({
                    ...state,
                    name,
                }),
                setTheme: (state, { theme }) => ({
                    ...state,
                    preferences: {
                        ...state.preferences,
                        theme,
                    },
                }),
                toggleNotifications: (state) => ({
                    ...state,
                    preferences: {
                        ...state.preferences,
                        notifications: !state.preferences.notifications,
                    },
                }),
            },
        ],

        ui: [
            {
                isLoading: false,
                error: null as string | null,
                showCompleted: true,
            },
            {
                setLoading: (state, { isLoading }) => ({
                    ...state,
                    isLoading,
                }),
                setError: (state, { error }) => ({
                    ...state,
                    error,
                }),
                toggleShowCompleted: (state) => ({
                    ...state,
                    showCompleted: !state.showCompleted,
                }),
            },
        ],

        stats: [
            {
                totalTodos: 3,
                completedTodos: 0,
                todayCount: 3,
            },
            {
                updateStats: (state) => state, // Will be handled by selectors
                addTodo: (state) => ({
                    ...state,
                    totalTodos: state.totalTodos + 1,
                    todayCount: state.todayCount + 1,
                }),
                deleteTodo: (state) => ({
                    ...state,
                    totalTodos: Math.max(0, state.totalTodos - 1),
                }),
                toggleTodo: (state) => ({
                    ...state,
                    completedTodos: state.completedTodos, // Will be recalculated
                }),
                clearCompleted: (state) => ({
                    ...state,
                    totalTodos: 0,
                    completedTodos: 0,
                }),
            },
        ],
    }),

    selectors({
        visibleTodos: [
            (s) => [s.todos, s.filter, s.ui],
            (todos, filter, ui) => {
                let filtered = todos

                if (filter === 'active') {
                    filtered = todos.filter((todo) => !todo.completed)
                } else if (filter === 'completed') {
                    filtered = todos.filter((todo) => todo.completed)
                }

                if (!ui.showCompleted) {
                    filtered = filtered.filter((todo) => !todo.completed)
                }

                return filtered
            },
        ],

        currentStats: [
            (s) => [s.todos],
            (todos) => ({
                totalTodos: todos.length,
                completedTodos: todos.filter((todo) => todo.completed).length,
                todayCount: todos.length, // Simplified for demo
            }),
        ],

        completionPercentage: [
            (s) => [s.currentStats],
            (stats) => {
                if (stats.totalTodos === 0) return 0
                return Math.round((stats.completedTodos / stats.totalTodos) * 100)
            },
        ],
    }),
])

import { configureStore } from '@reduxjs/toolkit'
import { posthogReduxLogger } from 'posthog-js/lib/src/customizations'

// Types
export interface Todo {
    id: number
    text: string
    completed: boolean
}

export type FilterType = 'all' | 'active' | 'completed'

export interface TodoState {
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

// Action Types
export const ADD_TODO = 'ADD_TODO' as const
export const TOGGLE_TODO = 'TOGGLE_TODO' as const
export const DELETE_TODO = 'DELETE_TODO' as const
export const SET_FILTER = 'SET_FILTER' as const
export const CLEAR_COMPLETED = 'CLEAR_COMPLETED' as const
export const SET_USER_NAME = 'SET_USER_NAME' as const
export const SET_THEME = 'SET_THEME' as const
export const TOGGLE_NOTIFICATIONS = 'TOGGLE_NOTIFICATIONS' as const
export const SET_LOADING = 'SET_LOADING' as const
export const SET_ERROR = 'SET_ERROR' as const
export const TOGGLE_SHOW_COMPLETED = 'TOGGLE_SHOW_COMPLETED' as const
export const UPDATE_STATS = 'UPDATE_STATS' as const

// Action Interfaces
export interface AddTodoAction {
    type: typeof ADD_TODO
    payload: Todo
}

export interface ToggleTodoAction {
    type: typeof TOGGLE_TODO
    payload: number
}

export interface DeleteTodoAction {
    type: typeof DELETE_TODO
    payload: number
}

export interface SetFilterAction {
    type: typeof SET_FILTER
    payload: FilterType
}

export interface ClearCompletedAction {
    type: typeof CLEAR_COMPLETED
}

export interface SetUserNameAction {
    type: typeof SET_USER_NAME
    payload: string
}

export interface SetThemeAction {
    type: typeof SET_THEME
    payload: 'light' | 'dark'
}

export interface ToggleNotificationsAction {
    type: typeof TOGGLE_NOTIFICATIONS
}

export interface SetLoadingAction {
    type: typeof SET_LOADING
    payload: boolean
}

export interface SetErrorAction {
    type: typeof SET_ERROR
    payload: string | null
}

export interface ToggleShowCompletedAction {
    type: typeof TOGGLE_SHOW_COMPLETED
}

export interface UpdateStatsAction {
    type: typeof UPDATE_STATS
}

export type TodoAction =
    | AddTodoAction
    | ToggleTodoAction
    | DeleteTodoAction
    | SetFilterAction
    | ClearCompletedAction
    | SetUserNameAction
    | SetThemeAction
    | ToggleNotificationsAction
    | SetLoadingAction
    | SetErrorAction
    | ToggleShowCompletedAction
    | UpdateStatsAction

// Action Creators
export const addTodo = (text: string): AddTodoAction => ({
    type: ADD_TODO,
    payload: {
        id: Date.now(),
        text,
        completed: false,
    },
})

export const toggleTodo = (id: number): ToggleTodoAction => ({
    type: TOGGLE_TODO,
    payload: id,
})

export const deleteTodo = (id: number): DeleteTodoAction => ({
    type: DELETE_TODO,
    payload: id,
})

export const setFilter = (filter: FilterType): SetFilterAction => ({
    type: SET_FILTER,
    payload: filter,
})

export const clearCompleted = (): ClearCompletedAction => ({
    type: CLEAR_COMPLETED,
})

export const setUserName = (name: string): SetUserNameAction => ({
    type: SET_USER_NAME,
    payload: name,
})

export const setTheme = (theme: 'light' | 'dark'): SetThemeAction => ({
    type: SET_THEME,
    payload: theme,
})

export const toggleNotifications = (): ToggleNotificationsAction => ({
    type: TOGGLE_NOTIFICATIONS,
})

export const setLoading = (isLoading: boolean): SetLoadingAction => ({
    type: SET_LOADING,
    payload: isLoading,
})

export const setError = (error: string | null): SetErrorAction => ({
    type: SET_ERROR,
    payload: error,
})

export const toggleShowCompleted = (): ToggleShowCompletedAction => ({
    type: TOGGLE_SHOW_COMPLETED,
})

export const updateStats = (): UpdateStatsAction => ({
    type: UPDATE_STATS,
})

// Initial State
const initialState: TodoState = {
    todos: [
        { id: 1, text: 'Learn Redux with TypeScript', completed: false },
        { id: 2, text: 'Build a todo app', completed: false },
        { id: 3, text: 'Test with PostHog', completed: false },
    ],
    filter: 'all',
    user: {
        name: 'Demo User',
        email: 'demo@example.com',
        preferences: {
            theme: 'light',
            notifications: true,
        },
    },
    ui: {
        isLoading: false,
        error: null,
        showCompleted: true,
    },
    stats: {
        totalTodos: 3,
        completedTodos: 0,
        todayCount: 3,
    },
}

// Reducer
export const todoReducer = (state: TodoState = initialState, action: TodoAction): TodoState => {
    switch (action.type) {
        case ADD_TODO:
            return {
                ...state,
                todos: [...state.todos, action.payload],
            }

        case TOGGLE_TODO:
            return {
                ...state,
                todos: state.todos.map((todo) =>
                    todo.id === action.payload ? { ...todo, completed: !todo.completed } : todo
                ),
            }

        case DELETE_TODO:
            return {
                ...state,
                todos: state.todos.filter((todo) => todo.id !== action.payload),
            }

        case SET_FILTER:
            return {
                ...state,
                filter: action.payload,
            }

        case CLEAR_COMPLETED:
            return {
                ...state,
                todos: state.todos.filter((todo) => !todo.completed),
            }

        case SET_USER_NAME:
            return {
                ...state,
                user: {
                    ...state.user,
                    name: action.payload,
                },
            }

        case SET_THEME:
            return {
                ...state,
                user: {
                    ...state.user,
                    preferences: {
                        ...state.user.preferences,
                        theme: action.payload,
                    },
                },
            }

        case TOGGLE_NOTIFICATIONS:
            return {
                ...state,
                user: {
                    ...state.user,
                    preferences: {
                        ...state.user.preferences,
                        notifications: !state.user.preferences.notifications,
                    },
                },
            }

        case SET_LOADING:
            return {
                ...state,
                ui: {
                    ...state.ui,
                    isLoading: action.payload,
                },
            }

        case SET_ERROR:
            return {
                ...state,
                ui: {
                    ...state.ui,
                    error: action.payload,
                },
            }

        case TOGGLE_SHOW_COMPLETED:
            return {
                ...state,
                ui: {
                    ...state.ui,
                    showCompleted: !state.ui.showCompleted,
                },
            }

        case UPDATE_STATS:
            return {
                ...state,
                stats: {
                    ...state.stats,
                    totalTodos: state.todos.length,
                    completedTodos: state.todos.filter((todo) => todo.completed).length,
                    todayCount: state.todos.length, // Simplified for demo
                },
            }

        default:
            return state
    }
}

// Create PostHog Redux logger middleware
const posthogMiddleware = posthogReduxLogger<TodoState>({
    // Example: optionally mask sensitive data from actions
    // maskReduxAction: (action) => {
    //     // Return null to skip logging this action entirely
    //     // if (action.type === 'SENSITIVE_ACTION') return null
    //
    //     // Mask sensitive fields in the action
    //     // if (action.type === 'SET_USER_DATA' && action.payload?.password) {
    //     //     return { ...action, payload: { ...action.payload, password: '[REDACTED]' } }
    //     // }
    // },

    // Example: optionally mask sensitive data from state
    // maskReduxState: (state) => {
    //     // You could remove sensitive fields from state here
    //     // const { sensitiveData, ...maskedState } = state
    //     // return maskedState
    // },

    // Example: custom logger function
    // logger: (title, reduxEvent) => {
    //     // Custom logging - could send to analytics, save to file, etc.
    //     console.warn(title, reduxEvent)
    //     // or disable logging entirely: () => {}
    //     // or log only errors: if (reduxEvent.type.includes('ERROR')) console.error(title, reduxEvent)
    // },
    // Example: slow action logging
    onDuration: (t, r, d) => {
        if (d > 1500) {
            console.error('SLOW ACTION DETECTED (' + d + 'ms): ', t, r)
        }
    },
})

// Create and export store with Redux Toolkit
export const store = configureStore({
    reducer: todoReducer,
    preloadedState: initialState,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(posthogMiddleware),
    devTools: true,
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

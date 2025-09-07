import {
    store,
    addTodo,
    toggleTodo,
    deleteTodo,
    setFilter,
    clearCompleted,
    setUserName,
    setTheme,
    toggleNotifications,
    setLoading,
    setError,
    updateStats,
    TodoState,
    FilterType,
} from './store'

// Get DOM elements with type assertions
const todoInput = document.getElementById('todo-input') as HTMLInputElement
const addBtn = document.getElementById('add-btn') as HTMLButtonElement
const todoList = document.getElementById('todo-list') as HTMLUListElement
const remainingCount = document.getElementById('remaining-count') as HTMLSpanElement
const clearCompletedBtn = document.getElementById('clear-completed') as HTMLButtonElement
const filterBtns = document.querySelectorAll<HTMLButtonElement>('.filter-btn')

// Render function
function render(): void {
    const state: TodoState = store.getState()
    const { todos, filter } = state

    // Filter todos based on current filter
    let filteredTodos = todos
    if (filter === 'active') {
        filteredTodos = todos.filter((todo) => !todo.completed)
    } else if (filter === 'completed') {
        filteredTodos = todos.filter((todo) => todo.completed)
    }

    // Clear and rebuild todo list
    todoList.innerHTML = ''

    filteredTodos.forEach((todo) => {
        const li = document.createElement('li')
        li.className = 'todo-item'

        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.className = 'todo-checkbox'
        checkbox.checked = todo.completed
        checkbox.dataset.id = todo.id.toString()

        const text = document.createElement('span')
        text.className = `todo-text ${todo.completed ? 'completed' : ''}`
        text.dataset.id = todo.id.toString()
        text.textContent = todo.text

        const deleteBtn = document.createElement('button')
        deleteBtn.className = 'delete-btn'
        deleteBtn.dataset.id = todo.id.toString()
        deleteBtn.textContent = 'Delete'

        li.appendChild(checkbox)
        li.appendChild(text)
        li.appendChild(deleteBtn)
        todoList.appendChild(li)
    })

    // Update remaining count
    const activeTodos = todos.filter((todo) => !todo.completed)
    remainingCount.textContent = `${activeTodos.length} ${activeTodos.length === 1 ? 'item' : 'items'} left`

    // Enable/disable clear completed button
    const hasCompleted = todos.some((todo) => todo.completed)
    clearCompletedBtn.disabled = !hasCompleted

    // Update filter buttons
    filterBtns.forEach((btn) => {
        if (btn.dataset.filter === filter) {
            btn.classList.add('active')
        } else {
            btn.classList.remove('active')
        }
    })
}

// Add todo handler
function handleAddTodo(): void {
    const text = todoInput.value.trim()
    if (text) {
        store.dispatch(addTodo(text))
        todoInput.value = ''
        todoInput.focus()
    }
}

// Event Listeners
addBtn.addEventListener('click', handleAddTodo)

todoInput.addEventListener('keypress', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
        handleAddTodo()
    }
})

// Delegate events for todo items
todoList.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement
    const id = parseInt(target.dataset.id || '0')

    if (target.classList.contains('todo-checkbox')) {
        store.dispatch(toggleTodo(id))
    } else if (target.classList.contains('todo-text')) {
        store.dispatch(toggleTodo(id))
    } else if (target.classList.contains('delete-btn')) {
        store.dispatch(deleteTodo(id))
    }
})

// Filter buttons
filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
        const filterValue = btn.dataset.filter as FilterType
        store.dispatch(setFilter(filterValue))
    })
})

// Clear completed
clearCompletedBtn.addEventListener('click', () => {
    store.dispatch(clearCompleted())
})

// Subscribe to store changes
store.subscribe(render)

// Initial render
render()

// Add event listeners for demo controls
const userNameInput = document.getElementById('user-name-input') as HTMLInputElement
const setNameBtn = document.getElementById('set-name-btn') as HTMLButtonElement
const toggleThemeBtn = document.getElementById('toggle-theme-btn') as HTMLButtonElement
const toggleNotificationsBtn = document.getElementById('toggle-notifications-btn') as HTMLButtonElement
const simulateLoadingBtn = document.getElementById('simulate-loading-btn') as HTMLButtonElement
const simulateErrorBtn = document.getElementById('simulate-error-btn') as HTMLButtonElement
const updateStatsBtn = document.getElementById('update-stats-btn') as HTMLButtonElement

setNameBtn.addEventListener('click', () => {
    const name = userNameInput.value.trim()
    if (name) {
        store.dispatch(setUserName(name))
        userNameInput.value = ''
    }
})

toggleThemeBtn.addEventListener('click', () => {
    const currentTheme = store.getState().user.preferences.theme
    store.dispatch(setTheme(currentTheme === 'light' ? 'dark' : 'light'))
})

toggleNotificationsBtn.addEventListener('click', () => {
    store.dispatch(toggleNotifications())
})

simulateLoadingBtn.addEventListener('click', () => {
    store.dispatch(setLoading(true))
    setTimeout(() => {
        store.dispatch(setLoading(false))
    }, 2000)
})

simulateErrorBtn.addEventListener('click', () => {
    store.dispatch(setError('Something went wrong!'))
    setTimeout(() => {
        store.dispatch(setError(null))
    }, 3000)
})

updateStatsBtn.addEventListener('click', () => {
    store.dispatch(updateStats())
})

// Export for global access if needed (useful for debugging)
;(window as any).todoStore = store
;(window as any).todoActions = {
    addTodo,
    toggleTodo,
    deleteTodo,
    setFilter,
    clearCompleted,
    setUserName,
    setTheme,
    toggleNotifications,
    setLoading,
    setError,
    updateStats,
}

import React from 'react'
import { useAppSelector, useAppDispatch } from '../hooks'
import { clearCompleted } from '../store'

export default function TodoStats() {
    const dispatch = useAppDispatch()
    const todos = useAppSelector((state) => state.todos)

    const activeTodos = todos.filter((todo) => !todo.completed)
    const hasCompleted = todos.some((todo) => todo.completed)

    return (
        <div className="stats">
            <span className="remaining-count">
                {activeTodos.length} {activeTodos.length === 1 ? 'item' : 'items'} left
            </span>
            <button className="clear-completed" disabled={!hasCompleted} onClick={() => dispatch(clearCompleted())}>
                Clear Completed
            </button>
        </div>
    )
}

import React from 'react'
import { useAppSelector, useAppDispatch } from '../hooks'
import { toggleTodo, deleteTodo } from '../store'

export default function TodoList() {
    const dispatch = useAppDispatch()
    const todos = useAppSelector((state) => state.todos)
    const filter = useAppSelector((state) => state.filter)

    const filteredTodos = todos.filter((todo) => {
        if (filter === 'active') return !todo.completed
        if (filter === 'completed') return todo.completed
        return true
    })

    return (
        <ul className="todo-list">
            {filteredTodos.map((todo) => (
                <li key={todo.id} className="todo-item">
                    <input
                        type="checkbox"
                        className="todo-checkbox"
                        checked={todo.completed}
                        onChange={() => dispatch(toggleTodo(todo.id))}
                    />
                    <span
                        className={`todo-text ${todo.completed ? 'completed' : ''}`}
                        onClick={() => dispatch(toggleTodo(todo.id))}
                    >
                        {todo.text}
                    </span>
                    <button className="delete-btn" onClick={() => dispatch(deleteTodo(todo.id))}>
                        Delete
                    </button>
                </li>
            ))}
        </ul>
    )
}

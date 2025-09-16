import React, { useState } from 'react'
import { useAppDispatch } from '../hooks'
import { addTodo } from '../store'

export default function TodoInput() {
    const [text, setText] = useState('')
    const dispatch = useAppDispatch()

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (text.trim()) {
            dispatch(addTodo(text.trim()))
            setText('')
        }
    }

    return (
        <form className="add-todo" onSubmit={handleSubmit}>
            <input
                type="text"
                className="todo-input"
                placeholder="Enter a new todo..."
                value={text}
                onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="add-btn">
                Add Todo
            </button>
        </form>
    )
}

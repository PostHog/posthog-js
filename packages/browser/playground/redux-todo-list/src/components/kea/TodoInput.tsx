import { useState } from 'react'
import { useActions } from 'kea'
import { todoLogic } from '../../todoLogic'

export default function TodoInput() {
    const { addTodo } = useActions(todoLogic)
    const [text, setText] = useState('')

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (text.trim()) {
            addTodo(text.trim())
            setText('')
        }
    }

    return (
        <div className="add-todo">
            <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Add a new todo..."
                className="todo-input"
                onKeyPress={(e) => e.key === 'Enter' && handleSubmit(e)}
            />
            <button onClick={handleSubmit} className="add-btn">
                Add Todo
            </button>
        </div>
    )
}

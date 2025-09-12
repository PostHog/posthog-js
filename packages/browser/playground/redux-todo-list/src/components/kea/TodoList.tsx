import { useActions, useValues } from 'kea'
import { todoLogic } from '../../todoLogic'

export default function TodoList() {
    const { visibleTodos } = useValues(todoLogic)
    const { toggleTodo, deleteTodo } = useActions(todoLogic)

    if (visibleTodos.length === 0) {
        return (
            <ul className="todo-list">
                <li style={{ textAlign: 'center', color: '#999', padding: '20px' }}>No todos to display</li>
            </ul>
        )
    }

    return (
        <ul className="todo-list">
            {visibleTodos.map((todo) => (
                <li key={todo.id} className="todo-item">
                    <input
                        type="checkbox"
                        checked={todo.completed}
                        onChange={() => toggleTodo(todo.id)}
                        className="todo-checkbox"
                    />
                    <span className={`todo-text ${todo.completed ? 'completed' : ''}`}>{todo.text}</span>
                    <button
                        onClick={() => deleteTodo(todo.id)}
                        className="delete-btn"
                        aria-label={`Delete "${todo.text}"`}
                    >
                        ×
                    </button>
                </li>
            ))}
        </ul>
    )
}

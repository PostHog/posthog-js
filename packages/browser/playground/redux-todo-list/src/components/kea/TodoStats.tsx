import { useValues } from 'kea'
import { todoLogic } from '../../todoLogic'

export default function TodoStats() {
    const { currentStats, completionPercentage } = useValues(todoLogic)

    return (
        <div className="todo-stats">
            <div className="stats-grid">
                <div className="stat-item">
                    <span className="stat-label">Total:</span>
                    <span className="stat-value">{currentStats.totalTodos}</span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">Completed:</span>
                    <span className="stat-value">{currentStats.completedTodos}</span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">Active:</span>
                    <span className="stat-value">{currentStats.totalTodos - currentStats.completedTodos}</span>
                </div>
                <div className="stat-item">
                    <span className="stat-label">Progress:</span>
                    <span className="stat-value">{completionPercentage}%</span>
                </div>
            </div>
            <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${completionPercentage}%` }} />
            </div>
        </div>
    )
}

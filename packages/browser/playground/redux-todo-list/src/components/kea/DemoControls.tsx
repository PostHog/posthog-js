import { useActions, useValues } from 'kea'
import { todoLogic } from '../../todoLogic'

export default function DemoControls() {
    const { user, ui, currentStats } = useValues(todoLogic)
    const {
        clearCompleted,
        setUserName,
        setTheme,
        toggleNotifications,
        setLoading,
        setError,
        toggleShowCompleted,
        updateStats,
    } = useActions(todoLogic)

    const simulateSlowAction = () => {
        setLoading(true)
        // Simulate a slow action to test performance monitoring
        setTimeout(() => {
            // eslint-disable-next-line compat/compat
            const start = performance.now()
            // Intentionally slow operation
            let sum = 0
            for (let i = 0; i < 10000000; i++) {
                sum += Math.random()
            }
            // eslint-disable-next-line compat/compat
            const end = performance.now()
            console.log(`Slow operation took ${end - start}ms, result: ${sum}`)
            setLoading(false)
        }, 100)
    }

    return (
        <div className="demo-controls">
            <h3>Kea Demo Controls</h3>
            <p className="demo-note">
                These controls demonstrate various Kea actions being logged by PostHog. Check your browser console to
                see the logging output.
            </p>

            <div className="control-section">
                <h4>Todo Actions</h4>
                <div className="button-group">
                    <button onClick={() => clearCompleted()} className="control-button">
                        Clear Completed
                    </button>
                    <button onClick={() => updateStats()} className="control-button">
                        Update Stats
                    </button>
                </div>
            </div>

            <div className="control-section">
                <h4>User Settings</h4>
                <div className="form-group">
                    <label>
                        User Name:
                        <input
                            type="text"
                            value={user.name}
                            onChange={(e) => setUserName(e.target.value)}
                            className="control-input"
                        />
                    </label>
                </div>
                <div className="button-group">
                    <button
                        onClick={() => setTheme(user.preferences.theme === 'light' ? 'dark' : 'light')}
                        className="control-button"
                    >
                        Toggle Theme ({user.preferences.theme})
                    </button>
                    <button onClick={() => toggleNotifications()} className="control-button">
                        {user.preferences.notifications ? 'Disable' : 'Enable'} Notifications
                    </button>
                </div>
            </div>

            <div className="control-section">
                <h4>UI Controls</h4>
                <div className="button-group">
                    <button onClick={() => toggleShowCompleted()} className="control-button">
                        {ui.showCompleted ? 'Hide' : 'Show'} Completed
                    </button>
                    <button
                        onClick={() => setError(ui.error ? null : 'This is a demo error message')}
                        className="control-button error"
                    >
                        {ui.error ? 'Clear Error' : 'Trigger Error'}
                    </button>
                    <button onClick={simulateSlowAction} className="control-button warning">
                        Simulate Slow Action
                    </button>
                </div>
                {ui.isLoading && <p className="loading-message">Loading...</p>}
                {ui.error && <p className="error-message">Error: {ui.error}</p>}
            </div>

            <div className="control-section">
                <h4>Current State Summary</h4>
                <div className="state-summary">
                    <pre>
                        {JSON.stringify(
                            {
                                user: user.name,
                                theme: user.preferences.theme,
                                notifications: user.preferences.notifications,
                                filter: 'current filter from parent',
                                stats: currentStats,
                                ui: {
                                    isLoading: ui.isLoading,
                                    hasError: !!ui.error,
                                    showCompleted: ui.showCompleted,
                                },
                            },
                            null,
                            2
                        )}
                    </pre>
                </div>
            </div>
        </div>
    )
}

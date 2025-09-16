import React, { useState } from 'react'
import { useAppSelector, useAppDispatch } from '../hooks'
import { setUserName, setTheme, toggleNotifications, setLoading, setError, updateStats } from '../store'

export default function DemoControls() {
    const [userName, setUserNameLocal] = useState('')
    const dispatch = useAppDispatch()
    const user = useAppSelector((state) => state.user)

    const handleSetName = () => {
        if (userName.trim()) {
            dispatch(setUserName(userName.trim()))
            setUserNameLocal('')
        }
    }

    const handleToggleTheme = () => {
        const newTheme = user.preferences.theme === 'light' ? 'dark' : 'light'
        dispatch(setTheme(newTheme))
    }

    const handleSimulateLoading = () => {
        dispatch(setLoading(true))
        setTimeout(() => {
            dispatch(setLoading(false))
        }, 2000)
    }

    const handleSimulateError = () => {
        dispatch(setError('Something went wrong!'))
        setTimeout(() => {
            dispatch(setError(null))
        }, 3000)
    }

    return (
        <div className="demo-controls">
            <h3>State Demo Controls</h3>
            <div className="control-group">
                <label>User Name:</label>
                <input
                    type="text"
                    className="user-name-input"
                    placeholder="Enter name"
                    value={userName}
                    onChange={(e) => setUserNameLocal(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSetName()}
                />
                <button onClick={handleSetName}>Update Name</button>
            </div>

            <div className="control-group">
                <label>Theme:</label>
                <button onClick={handleToggleTheme}>Toggle Theme (Current: {user.preferences.theme})</button>
                <button onClick={() => dispatch(toggleNotifications())}>
                    Toggle Notifications ({user.preferences.notifications ? 'On' : 'Off'})
                </button>
            </div>

            <div className="control-group">
                <button onClick={handleSimulateLoading}>Simulate Loading</button>
                <button onClick={handleSimulateError}>Simulate Error</button>
                <button onClick={() => dispatch(updateStats())}>Update Stats</button>
            </div>
        </div>
    )
}

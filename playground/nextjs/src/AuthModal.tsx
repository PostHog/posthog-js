/* eslint-disable compat/compat */
import { useState } from 'react'
import { getUser, TEAMS, User, useUser } from './auth'
import { posthogHelpers } from './posthog'

export const AuthModal = ({ onClose }: { onClose: () => void }) => {
    const actualUser = useUser()
    const [user, setUser] = useState<Partial<User>>(getUser() ?? {})

    async function handleLogin() {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user),
        })

        if (response.ok) {
            posthogHelpers.onLogin(user as User)
            onClose()
        } else {
            alert('Login failed')
            // Handle errors
        }
    }

    async function handleLogout() {
        const response = await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '',
        })

        if (response.ok) {
            posthogHelpers.onLogout()
            onClose()
        } else {
            alert('Logout failed')
            // Handle errors
        }
    }

    return (
        <div className={'fixed inset-0 z-10 flex justify-center items-center'}>
            <div className="absolute inset-0 bg-slate-500 opacity-70 -z-10" onClick={() => onClose()} />

            <div className="mx-auto w-[30rem] bg-white rounded shadow-md p-4">
                <h2>User account</h2>

                <form className="flex flex-col gap-2" onSubmit={(e) => e.preventDefault()}>
                    <input
                        className="border rounded p-2"
                        type="email"
                        name="email"
                        placeholder="Email"
                        required
                        value={user.email}
                        onChange={(e) => setUser({ ...user, email: e.target.value })}
                    />
                    <input
                        className="border rounded p-2"
                        type="name"
                        name="name"
                        placeholder="Name"
                        required
                        value={user.name}
                        onChange={(e) => setUser({ ...user, name: e.target.value })}
                    />

                    <select
                        name="team"
                        value={user.team?.id}
                        onChange={(e) => setUser({ ...user, team: TEAMS.find((t) => t.id === e.target.value) })}
                        className="border rounded p-2"
                    >
                        <option value={undefined}>Please select</option>
                        {TEAMS.map((team) => (
                            <option key={team.id} value={team.id}>
                                {team.name}
                            </option>
                        ))}
                    </select>

                    <div className="flex justify-end gap-2 mt-2">
                        {actualUser ? <button onClick={() => handleLogout()}>Logout</button> : null}
                        <div className="flex-1" />
                        <button onClick={() => onClose()}>Cancel</button>
                        <button className="button" onClick={() => handleLogin()}>
                            {actualUser ? 'Update' : 'Login'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

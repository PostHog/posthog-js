'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePostHog } from '@posthog/next'

export default function AuthPage() {
    const posthog = usePostHog()
    const [email, setEmail] = useState('')
    const [loggedInAs, setLoggedInAs] = useState<string | null>(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('posthog-example-user')
        }
        return null
    })

    function handleLogin(e: React.FormEvent) {
        e.preventDefault()
        if (!email) return

        posthog.identify(email, { email })
        localStorage.setItem('posthog-example-user', email)
        setLoggedInAs(email)
        setEmail('')
        window.dispatchEvent(new Event('auth-change'))
    }

    function handleLogout() {
        posthog.reset()
        localStorage.removeItem('posthog-example-user')
        setLoggedInAs(null)
        window.dispatchEvent(new Event('auth-change'))
    }

    return (
        <div>
            <h1 className="text-2xl font-bold mb-2">Authentication</h1>
            <p className="text-gray-600 mb-6">
                This demo uses <code className="bg-gray-100 px-1 rounded">posthog.identify()</code> and{' '}
                <code className="bg-gray-100 px-1 rounded">posthog.reset()</code> to manage user identity. After logging
                in, visit the{' '}
                <Link href="/server-flags" className="text-blue-600 underline">
                    Server Flags
                </Link>{' '}
                page to see the same identity reflected server-side.
            </p>

            {loggedInAs ? (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <p className="mb-4">
                        Logged in as <strong>{loggedInAs}</strong>
                    </p>
                    <p className="text-sm text-gray-500 mb-4">
                        Distinct ID: <code className="bg-gray-100 px-1 rounded">{posthog.get_distinct_id()}</code>
                    </p>
                    <button
                        onClick={handleLogout}
                        className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-700"
                    >
                        Log out
                    </button>
                </div>
            ) : (
                <form onSubmit={handleLogin} className="bg-white rounded-lg border border-gray-200 p-6">
                    <label htmlFor="email" className="block mb-2 text-sm font-medium">
                        Email
                    </label>
                    <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="user@example.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded mb-4"
                        required
                    />
                    <button type="submit" className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-700">
                        Log in
                    </button>
                </form>
            )}
        </div>
    )
}

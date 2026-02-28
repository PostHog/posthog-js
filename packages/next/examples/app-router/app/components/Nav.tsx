'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

const links = [
    { href: '/', label: 'Home' },
    { href: '/auth', label: 'Auth' },
    { href: '/server-flags', label: 'Server Flags' },
    { href: '/client-hooks', label: 'Client Hooks' },
    { href: '/capture', label: 'Capture' },
    { href: '/middleware-demo', label: 'Middleware' },
]

export function Nav() {
    const [user, setUser] = useState<string | null>(null)

    useEffect(() => {
        const update = () => setUser(localStorage.getItem('posthog-example-user'))
        update()
        /* eslint-disable posthog-js/no-add-event-listener */
        window.addEventListener('auth-change', update)
        window.addEventListener('storage', update)
        /* eslint-enable posthog-js/no-add-event-listener */
        return () => {
            window.removeEventListener('auth-change', update)
            window.removeEventListener('storage', update)
        }
    }, [])

    return (
        <nav className="border-b border-gray-200 bg-white">
            <div className="max-w-4xl mx-auto px-4 flex items-center justify-between h-14">
                <div className="flex items-center gap-6">
                    <span className="font-semibold text-gray-900">@posthog/next</span>
                    <div className="flex gap-4">
                        {links.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className="text-sm text-gray-600 hover:text-gray-900"
                            >
                                {link.label}
                            </Link>
                        ))}
                    </div>
                </div>
                <div className="text-sm text-gray-500">
                    {user ? (
                        <span>
                            Logged in as <strong className="text-gray-900">{user}</strong>
                        </span>
                    ) : (
                        <span>Anonymous</span>
                    )}
                </div>
            </div>
        </nav>
    )
}

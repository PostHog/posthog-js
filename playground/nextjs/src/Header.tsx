import Link from 'next/link'
import { useState } from 'react'
import { AuthModal } from './AuthModal'
import { useUser } from './auth'
export const PageHeader = () => {
    const user = useUser()

    const [showLogin, setShowLogin] = useState(false)

    return (
        <>
            <div className="sticky top-0 bg-white border-b mb-4 z-10">
                <div className="flex items-center gap-2">
                    <Link href="/" onClick={() => alert('yo!')}>
                        <h1 className="m-0">
                            <b>PostHog</b> React
                        </h1>
                    </Link>

                    <div className="flex-1" />
                    <div className="flex items-center gap-2">
                        <Link href="/replay-examples/animations">Animations</Link>
                        <Link href="/replay-examples/iframe">Iframe</Link>
                        <Link href="/replay-examples/canvas">Canvas</Link>
                        <Link href="/replay-examples/media">Media</Link>
                        <Link href="/replay-examples/long">Long</Link>
                    </div>

                    <div>
                        <button
                            onClick={() => {
                                setShowLogin(!showLogin)
                            }}
                        >
                            {user ? `Hi, ${user.name}` : 'Login'}
                        </button>
                    </div>
                </div>

                {showLogin ? <AuthModal onClose={() => setShowLogin(false)} /> : null}
            </div>
        </>
    )
}

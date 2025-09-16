import Head from 'next/head'
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

// Dynamically import Kea components to avoid SSR issues
const TodoInput = dynamic(() => import('../src/components/kea/TodoInput'), { ssr: false })
const TodoFilters = dynamic(() => import('../src/components/kea/TodoFilters'), { ssr: false })
const TodoList = dynamic(() => import('../src/components/kea/TodoList'), { ssr: false })
const TodoStats = dynamic(() => import('../src/components/kea/TodoStats'), { ssr: false })
const DemoControls = dynamic(() => import('../src/components/kea/DemoControls'), { ssr: false })

export default function KeaPage() {
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        // Initialize Kea context with PostHog logger on client side
        import('../src/kea-store').then(() => {
            setMounted(true)
        })
    }, [])

    return (
        <>
            <Head>
                <title>Kea Todo List</title>
                <meta name="description" content="Kea Todo List with PostHog integration" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <link rel="icon" href="/favicon.ico" />
            </Head>
            <div className="container">
                <h1>Kea Todo List</h1>
                <p style={{ marginBottom: '0.5rem', color: '#666' }}>
                    This page uses Kea instead of Redux for state management.
                </p>
                <p style={{ marginBottom: '1rem' }}>
                    <a href="/" style={{ color: '#0070f3', textDecoration: 'none' }}>
                        ← Back to Home
                    </a>
                    {' | '}
                    <a href="/redux" style={{ color: '#0070f3', textDecoration: 'none' }}>
                        → Try the Redux version
                    </a>
                </p>
                {mounted ? (
                    <>
                        <TodoInput />
                        <TodoFilters />
                        <TodoList />
                        <TodoStats />
                        <DemoControls />
                    </>
                ) : (
                    <p>Loading Kea components...</p>
                )}
            </div>
        </>
    )
}

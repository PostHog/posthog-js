import Head from 'next/head'
import TodoInput from '../src/components/TodoInput'
import TodoFilters from '../src/components/TodoFilters'
import TodoList from '../src/components/TodoList'
import TodoStats from '../src/components/TodoStats'
import DemoControls from '../src/components/DemoControls'

export default function Home() {
    return (
        <>
            <Head>
                <title>Redux Todo List</title>
                <meta name="description" content="Redux Todo List with PostHog integration" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <link rel="icon" href="/favicon.ico" />
            </Head>
            <div className="container">
                <h1>Redux Todo List</h1>
                <p style={{ marginBottom: '1rem' }}>
                    <a href="/kea" style={{ color: '#0070f3', textDecoration: 'none' }}>
                        → Try the Kea version
                    </a>
                </p>
                <TodoInput />
                <TodoFilters />
                <TodoList />
                <TodoStats />
                <DemoControls />
            </div>
        </>
    )
}

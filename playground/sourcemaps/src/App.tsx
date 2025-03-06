import { lazy } from 'react'
import posthog from 'posthog-js'

const SubApp = lazy(() => import('./SubApp'))

function sendException() {
    const error = new Error('Test Error')
    posthog.captureException(error)
    throw error
}

function App() {
    return (
        <>
            <h1>Error testing</h1>
            <div className="card">
                <button onClick={() => sendException()}>Send exception</button>
            </div>
            <SubApp />
        </>
    )
}

export default App

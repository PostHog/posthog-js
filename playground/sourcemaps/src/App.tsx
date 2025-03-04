import { useState } from 'react'
import { lazy } from 'react'

const SubApp = lazy(() => import('./SubApp'))

function App() {
    const [count, setCount] = useState(0)

    return (
        <>
            <h1>Vite + React</h1>
            <div className="card">
                <button onClick={() => setCount((count) => count + 1)}>count is {count}</button>
            </div>
            <SubApp />
        </>
    )
}

export default App

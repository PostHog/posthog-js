import { useState } from 'react'
import { usePostHog } from '@posthog/react'
import { useSpacetimeDB, useTable, useReducer, useProcedure } from 'spacetimedb/react'
import { tables, reducers, procedures } from './module_bindings'
import './App.css'

function App() {
    const [name, setName] = useState('')
    const [procedureStatus, setProcedureStatus] = useState<string | null>(null)

    const posthog = usePostHog()
    const conn = useSpacetimeDB()
    const { isActive: connected } = conn
    const myDistinctId = conn.identity?.toHexString() ?? 'anonymous'

    const [people] = useTable(tables.person)
    const [flagRows] = useTable(tables.featureFlag)
    const addPerson = useReducer(reducers.add)
    const requestFlagEval = useReducer(reducers.requestFlagEval)
    const captureEvent = useProcedure(procedures.captureEvent)

    const myFlagsRow = flagRows.find((r) => r.distinctId === myDistinctId)
    const myFlags: Record<string, boolean | string> = myFlagsRow ? JSON.parse(myFlagsRow.flagsJson) : {}

    const handleAdd = (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim() || !connected) return

        // Frontend instrumentation (posthog-js): the click that triggers the reducer.
        // The resulting row insert is captured separately, server-side, by the sidecar.
        posthog.capture('add_person_clicked', { name })
        addPerson({ name })
        setName('')
    }

    const handleInModuleCapture = async () => {
        if (!connected) return
        // Calls the module procedure, which posts to PostHog from inside the database.
        const ok = await captureEvent({ distinctId: myDistinctId, event: 'server_side_ping' })
        setProcedureStatus(ok ? 'sent ✓' : 'failed ✗')
    }

    return (
        <div className="app">
            <h1>SpacetimeDB × PostHog</h1>

            <p className="status">
                Status: <strong className={connected ? 'ok' : 'bad'}>{connected ? 'Connected' : 'Disconnected'}</strong>
            </p>

            <section>
                <h2>1. Reducer → sidecar instrumentation</h2>
                <p className="hint">
                    Adding a person calls the <code>add</code> reducer. The Node sidecar sees the row insert and
                    captures <code>person_added</code> with <code>posthog-node</code>.
                </p>
                <form onSubmit={handleAdd}>
                    <input
                        type="text"
                        placeholder="Enter a name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={!connected}
                    />
                    <button type="submit" disabled={!connected}>
                        Add person
                    </button>
                </form>
            </section>

            <section>
                <h2>2. Procedure → in-module instrumentation</h2>
                <p className="hint">
                    Calls the <code>captureEvent</code> procedure, which posts <code>server_side_ping</code> to PostHog
                    over <code>ctx.http</code> from inside the module — no sidecar involved.
                </p>
                <button onClick={handleInModuleCapture} disabled={!connected}>
                    Send server-side event
                </button>
                {procedureStatus && <span className="hint"> {procedureStatus}</span>}
            </section>

            <section>
                <h2>3. Local feature-flag evaluation</h2>
                <p className="hint">
                    Asks the backend to evaluate flags via the <code>requestFlagEval</code> reducer. The sidecar
                    evaluates them <strong>locally</strong> with the personal API key, then writes them to the{' '}
                    <code>feature_flag</code> table — which this view subscribes to. Your distinct id:{' '}
                    <code>{myDistinctId.slice(0, 16)}…</code>
                </p>
                <button
                    onClick={() => connected && requestFlagEval({ distinctId: myDistinctId })}
                    disabled={!connected}
                >
                    Evaluate my flags
                </button>
                {myFlagsRow ? (
                    Object.keys(myFlags).length === 0 ? (
                        <p className="hint">
                            No flags returned for this distinct id (none active, or none defined in the project).
                        </p>
                    ) : (
                        <ul>
                            {Object.entries(myFlags).map(([key, value]) => (
                                <li key={key}>
                                    <code>{key}</code>: <strong>{String(value)}</strong>
                                </li>
                            ))}
                        </ul>
                    )
                ) : (
                    <p className="hint">Not evaluated yet.</p>
                )}
            </section>

            <section>
                <h2>People ({people.length})</h2>
                {people.length === 0 ? (
                    <p className="hint">No people yet. Add someone above.</p>
                ) : (
                    <ul>
                        {people.map((person, i) => (
                            <li key={i}>{person.name}</li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    )
}

export default App

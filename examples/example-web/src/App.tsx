import { useEffect, useState } from 'react'
import './App.css'
import { posthog } from './posthog'

const GLOBAL_EVENTS: { event: string; payload: any }[] = []
export const usePostHogDebugEvents = () => {
  const [localEvents, setLocalEvents] = useState(GLOBAL_EVENTS)

  useEffect(() => {
    const onEvent = (event: string, payload: any) => {
      // console.log('On event', event, payload)
      GLOBAL_EVENTS.push({
        event,
        payload,
      })
      setLocalEvents([...GLOBAL_EVENTS])
    }

    const listeners = [
      posthog.on('capture', (e) => onEvent('capture', e)),
      posthog.on('identify', (e) => onEvent('identify', e)),
      posthog.on('screen', (e) => onEvent('screen', e)),
      posthog.on('autocapture', (e) => onEvent('autocapture', e)),
      posthog.on('featureflags', (e) => onEvent('featureflags', e)),
      posthog.on('flush', (e) => onEvent('flush', e)),
    ]

    return () => {
      listeners.forEach((x) => x())
    }
  }, [])

  return localEvents
}

const DebugEvents = (): JSX.Element => {
  const events = usePostHogDebugEvents()

  return (
    <div className="Debugger">
      <h2>Events Log</h2>
      {events.map((item) => (
        <div>
          <>
            <span>{item.event}</span>
            <span>{JSON.stringify(item.payload || '').substring(0, 100) + '...'}</span>
          </>
        </div>
      ))}
    </div>
  )
}

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <p>This is an example app for testing the posthog-js-lite lib</p>
        <button className="Button" onClick={() => posthog.capture('random event', { random: Math.random() })}>
          Track Event
        </button>
        <button className="Button" onClick={() => posthog.identify('user-123')}>
          Identify
        </button>
      </header>

      <DebugEvents />
    </div>
  )
}

export default App

'use client'
import { usePostHog } from 'posthog-js/react'

export default function Home() {
  const posthog = usePostHog()
  return (
    <div>
      <main>
        <div>
          <button onClick={() => posthog.captureException(new Error('exception captured'))}>Send exception!</button>
        </div>
      </main>
    </div>
  )
}

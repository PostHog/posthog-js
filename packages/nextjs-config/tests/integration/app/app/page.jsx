'use client'
import { useState } from 'react'

export default function Page() {
  const [value, setValue] = useState('not loaded')
  return (
    <>
      <button id="load" onClick={async () => setValue((await import('./lazy')).default)}>
        Load
      </button>
      <p id="result">{value}</p>
      <button id="capture" onClick={() => window.posthog.captureException(new Error('CDN fixture error'))}>
        Capture
      </button>
    </>
  )
}

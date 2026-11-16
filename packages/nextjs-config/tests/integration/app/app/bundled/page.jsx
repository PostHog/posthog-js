'use client'
import posthog from 'posthog-js'
import { useEffect, useState } from 'react'

export default function Page() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    window.bundledClient = posthog.init(
      'phc_integration',
      {
        api_host: 'https://posthog.test',
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        advanced_disable_decide: true,
        _disable_external_dependency_loading: true,
        opt_out_useragent_filter: true,
        persistence: 'memory',
        before_send(event) {
          if (event.event === '$exception') window.bundledException = event
          return null
        },
      },
      'bundled'
    )
    setReady(true)
  }, [])
  return (
    <button
      id="capture"
      disabled={!ready}
      onClick={() => window.bundledClient.captureException(new Error('Bundled fixture error'))}
    >
      Capture
    </button>
  )
}

// A posthog-node stand-in that records events in memory and prints one line each.
// No API key, no network — the assertions read the recorded array over /__events.

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

export function createRecorder(label) {
  const events = []
  const warnings = []

  const summarise = (e) => {
    const p = e.properties ?? {}
    return [
      e.event,
      p.$mcp_tool_name ? `tool=${p.$mcp_tool_name}` : null,
      p.$session_id ? `session=${String(p.$session_id).slice(0, 12)}…` : null,
      p.$mcp_client_name ? `client=${p.$mcp_client_name}` : null,
      p.$mcp_is_error ? 'ERROR' : null,
    ]
      .filter(Boolean)
      .join(' ')
  }

  const record = (event) => {
    events.push(event)
    console.log(`${DIM}[${label}]${RESET} ${summarise(event)}`)
  }

  const client = {
    capture: (event) => record(event),
    identify: (event) => record({ ...event, event: '$identify' }),
    captureException: (error, distinctId, properties) =>
      record({ event: '$exception', distinctId, properties: { ...properties, message: String(error) } }),
    flush: async () => {},
    shutdown: async () => {},
  }

  return {
    client,
    events,
    warnings,
    // instrument() reports every internal failure through its logger; a testbed
    // that ignores those would miss exactly the silent-degradation bug this
    // harness exists to catch.
    logger: (...args) => {
      const line = args.join(' ')
      // Match the SDK's own prefixes only. A substring match on /fail/ would
      // flag the routine "Tool fail_always callback already wrapped" notice.
      if (/^(Warning|Error):|compatibility error|Failed to /.test(line)) warnings.push(line)
      console.log(`${DIM}[${label}:sdk]${RESET} ${line}`)
    },
    reset: () => {
      events.length = 0
      warnings.length = 0
    },
  }
}

/** Serves the recorded state so the out-of-process client can assert on it. */
export function handleInspectionRoute(req, res, recorder) {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/__events') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ events: recorder.events, warnings: recorder.warnings }))
    return true
  }
  if (url.pathname === '/__reset') {
    recorder.reset()
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
    return true
  }
  return false
}

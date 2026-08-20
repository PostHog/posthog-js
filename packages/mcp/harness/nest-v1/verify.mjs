// v1 no-regression guard for the NestJS adapter:
// NestJS + @rekog/mcp-nest 1.9.x + MCP SDK v1, stateless streamable HTTP.
//
// Same assertions and same tools as the v2 harness, so the two are directly
// comparable. SDK v1 is frozen at protocol 2025-11-25, so there is no modern lane.
//
//   node verify.mjs                 # LEVEL=high — instrument(server), as documented
//   LEVEL=low node verify.mjs       # the instrument(server.server) workaround
//
// The server binds an ephemeral port (PORT=0) and announces it on stdout; set
// PORT explicitly to pin one for manual runs.
//
// Raw JSON-RPC over fetch, never the SDK Client — a stock v2 Client negotiates
// the LEGACY era and would report green having tested none of 2026-07-28.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('.', import.meta.url))
const TS_NODE = fileURLToPath(new URL('../../node_modules/.bin/ts-node', import.meta.url))
const EXPLICIT_PORT = process.env.PORT ? Number(process.env.PORT) : null
const LEVEL = process.env.LEVEL === 'low' ? 'low' : 'high'
const TOKEN = 'acceptance-token'
let BASE

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`  ${ok ? GREEN + '✓' : RED + '✗'}${RESET} ${name}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
}

async function waitUp() {
  // ts-node compiles the Nest graph on boot; be generous.
  for (let i = 0; i < 480; i++) {
    try {
      await fetch(`${BASE}/__events`)
      return true
    } catch {
      await sleep(250)
    }
  }
  return false
}

const readState = async () => (await fetch(`${BASE}/__events`)).json()
const resetState = () => fetch(`${BASE}/__reset`)

/** A 2025-era (legacy) request: an initialize handshake, no _meta envelope. */
function legacyHeaders() {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${TOKEN}`,
  }
}

// A real client replays the Mcp-Session-Id it was handed on every later request.
// Without this the harness reports a session/identity failure that no real client
// would see: on a stateless server the replayed token is the ONLY thing carrying
// client info and the negotiated protocol version between per-request instances.
let sessionId

let id = 0
async function rpc(method, params = {}) {
  const body = { jsonrpc: '2.0', id: ++id, method, params }
  const headers = legacyHeaders()
  if (sessionId) headers['mcp-session-id'] = sessionId
  const res = await fetch(`${BASE}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) })
  const minted = res.headers.get('mcp-session-id')
  if (minted) sessionId = minted
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    // SSE framing — pull the data: line out
    const line = text.split('\n').find((l) => l.startsWith('data:'))
    json = line ? JSON.parse(line.slice(5).trim()) : { raw: text.slice(0, 200) }
  }
  return { status: res.status, headers: res.headers, json }
}

async function runLegacy() {
  console.log(`\n2025-11-25 (legacy) · LEVEL=${LEVEL}`)
  sessionId = undefined
  await resetState()

  await rpc('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'acceptance-client', version: '9.9' },
  })

  const list = await rpc('tools/list')
  const tools = list.json?.result?.tools ?? []
  const echoTool = tools.find((t) => t.name === 'echo')

  const call = await rpc('tools/call', { name: 'echo', arguments: { text: 'hi' } })
  await rpc('tools/call', { name: 'fail_always', arguments: {} })

  await sleep(150)
  const { events, warnings } = await readState()
  const toolCalls = events.filter((e) => e.event === '$mcp_tool_call')
  const listings = events.filter((e) => e.event === '$mcp_tools_list')
  const echoCall = toolCalls.find((e) => e.properties?.$mcp_tool_name === 'echo')
  const failCall = toolCalls.find((e) => e.properties?.$mcp_tool_name === 'fail_always')

  // --- the server still works at all (regression floor) ---
  check('host server answers tools/list', list.status === 200 && tools.length > 0, `${tools.length} tools`)
  check('host server answers tools/call', call.status === 200, `HTTP ${call.status}`)
  check('tool result is correct', call.json?.result?.content?.[0]?.text === 'hi')

  // --- it captures at all ---
  check('instrument() logged no warning', warnings.length === 0, warnings[0] ?? '')
  check('$mcp_tools_list captured', listings.length >= 1, `got ${listings.length}`)
  check('$mcp_tool_call captured for echo', !!echoCall)
  check('$mcp_tool_call captured for fail_always', !!failCall)
  check('error call recorded as an error', failCall?.properties?.$mcp_is_error === true)
  check(
    'error message is clean',
    failCall?.properties?.$mcp_error_message === 'intentional failure',
    JSON.stringify(failCall?.properties?.$mcp_error_message)
  )

  // --- the injected context parameter reaches the wire ---
  check('context parameter advertised on tools/list', !!echoTool?.inputSchema?.properties?.context)
  check('conversation_id advertised on tools/list', !!echoTool?.inputSchema?.properties?.conversation_id)

  // --- identity ---
  check('identify() resolved a user', echoCall?.distinctId === `user_${TOKEN}`, `distinct_id=${echoCall?.distinctId}`)
  check('client name recorded', !!echoCall?.properties?.$mcp_client_name, echoCall?.properties?.$mcp_client_name)
  check(
    'protocol version recorded',
    !!echoCall?.properties?.$mcp_protocol_version,
    echoCall?.properties?.$mcp_protocol_version
  )

  // --- ownership on a per-request instance ---
  const intentCall = await rpc('tools/call', {
    name: 'echo',
    arguments: { text: 'hi', context: 'checking adoption numbers' },
  })
  await sleep(150)
  const after = await readState()
  const withIntent = after.events.filter((e) => e.event === '$mcp_tool_call').find((e) => e.properties?.$mcp_intent)
  check(
    '$mcp_intent captured from the context argument',
    withIntent?.properties?.$mcp_intent === 'checking adoption numbers',
    JSON.stringify(withIntent?.properties?.$mcp_intent)
  )
  check(
    'context argument stripped before the tool ran',
    intentCall.json?.result?.content?.[0]?.text === 'hi',
    JSON.stringify(intentCall.json?.result?.content?.[0]?.text)
  )
}

// With an explicit PORT, fail fast rather than silently assert against someone
// else's server — a stale process holding the port may have booted with a
// different LEVEL. (Meaningless for the ephemeral default.)
if (EXPLICIT_PORT) {
  try {
    await fetch(`http://localhost:${EXPLICIT_PORT}/__events`)
    console.error(`port ${EXPLICIT_PORT} is already serving. Kill it first before verifying.`)
    process.exit(1)
  } catch {
    // nothing listening — good
  }
}

// Spawn the binary directly, not through a runner: an extra process layer would
// orphan the ts-node grandchild that actually holds the port when killed.
// `detached` puts the child in its own group so the whole tree dies with it.
const child = spawn(TS_NODE, ['src/main.ts'], {
  cwd: DIR,
  env: { ...process.env, PORT: String(EXPLICIT_PORT ?? 0), LEVEL },
  stdio: ['ignore', 'pipe', 'inherit'],
  detached: true,
})

function killServer() {
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
}
process.on('exit', killServer)
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    killServer()
    process.exit(1)
  })
}

// The server announces its (possibly ephemeral) port on stdout.
const port = await new Promise((resolve) => {
  let out = ''
  child.stdout.on('data', (d) => {
    process.stdout.write(d)
    out += d
    const m = out.match(/MCP_HARNESS_LISTENING port=(\d+)/)
    if (m) resolve(Number(m[1]))
  })
  child.on('exit', () => resolve(null))
  setTimeout(() => resolve(null), 120000)
})
if (!port) {
  console.error('server never announced a port')
  killServer()
  process.exit(1)
}
BASE = `http://localhost:${port}`

if (!(await waitUp())) {
  console.error('server never came up')
  killServer()
  process.exit(1)
}

await runLegacy()

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} passed`)
killServer()
process.exit(passed === results.length ? 0 : 1)

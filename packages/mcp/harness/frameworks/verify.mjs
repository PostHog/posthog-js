// Acceptance test for MCP frameworks that build the MCP server for the customer:
// does the setup our docs show still capture tool calls, errors, intent,
// identity and sessions, over real HTTP, on every protocol era the framework serves?
//
//   node verify.mjs mcp-handler
//
// Each row boots its own server process (ephemeral port) so no state leaks between rows.
// Known-broken cells live in expected-failures.json, matched exactly as in the
// other lanes: a regression fails, and so does an unexpected improvement.
//
// Raw JSON-RPC over fetch, never an SDK Client: a stock Client negotiates one
// era and would report green having tested only that one.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const FRAMEWORKS = {
  'mcp-handler': {
    server: 'mcp-handler/server.mjs',
    eras: ['legacy', 'modern'],
    rows: [
      { label: 'instrument first', env: { ORDER: 'first' } },
      { label: 'instrument last', env: { ORDER: 'last' } },
      { label: 'without withMcpSessionHeader', env: { ORDER: 'first', WRAP: '0' } },
    ],
  },
  // FastMCP 4 runs on SDK v1, which serves only the 2025 protocol.
  fastmcp: {
    server: 'fastmcp/server.mjs',
    eras: ['legacy'],
    rows: [
      { label: 'stateful', env: { MODE: 'stateful' } },
      { label: 'stateless', env: { MODE: 'stateless' } },
      { label: 'stateless json', env: { MODE: 'json' } },
    ],
  },
}

const TOKEN = 'acceptance-token'
const CLIENT = { name: 'acceptance-client', version: '9.9' }
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const frameworkName = process.argv[2]
const framework = FRAMEWORKS[frameworkName]
if (!framework) {
  console.error(`usage: node verify.mjs <${Object.keys(FRAMEWORKS).join('|')}>`)
  process.exit(1)
}

const results = []

function checker(row, era) {
  return (name, ok, detail = '') => {
    results.push({ row, era, name, ok })
    console.log(`  ${ok ? GREEN + '✓' : RED + '✗'}${RESET} ${name}${detail ? `  ${DIM}${detail}${RESET}` : ''}`)
  }
}

/** A client of one protocol era, replaying whatever session header the server hands it, as real clients do. */
function createClient(base, era) {
  let sessionId
  let negotiated
  let id = 0
  return async function rpc(method, params = {}) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${TOKEN}`,
    }
    const body = { jsonrpc: '2.0', id: ++id, method, params }
    if (era === 'modern') {
      // 2026-07-28 needs all three _meta keys plus the Mcp-Method (and Mcp-Name) headers.
      Object.assign(headers, { 'mcp-protocol-version': '2026-07-28', 'mcp-method': method })
      if (params.name) headers['mcp-name'] = params.name
      body.params = {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': CLIENT,
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      }
    } else if (negotiated) {
      headers['mcp-protocol-version'] = negotiated
    }
    if (sessionId) headers['mcp-session-id'] = sessionId
    const res = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) })
    sessionId = res.headers.get('mcp-session-id') ?? sessionId
    const text = await res.text()
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'))
    let json
    try {
      json = JSON.parse(dataLine ? dataLine.slice(5) : text)
    } catch {
      json = { raw: text.slice(0, 200) }
    }
    if (method === 'initialize') negotiated = json?.result?.protocolVersion
    return { status: res.status, headers: res.headers, json }
  }
}

/** The handle `enableConversationId` appends to a tool result, which the agent echoes on its next call. */
function conversationIdOf(result) {
  for (const part of result?.content ?? []) {
    try {
      const id = JSON.parse(part.text)?.conversation_id
      if (id) return id
    } catch {
      // not the handle part
    }
  }
}

async function runEra({ base, inspect }, row, era) {
  console.log(`\n${row.label} · ${era === 'modern' ? '2026-07-28' : '2025-11-25'}`)
  const check = checker(row.label, era)
  await fetch(`${inspect}/__reset`)
  const rpc = createClient(base, era)

  if (era === 'legacy') {
    await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: CLIENT })
  }
  const list = await rpc('tools/list')
  const echoTool = list.json?.result?.tools?.find((t) => t.name === 'echo')
  const first = await rpc('tools/call', { name: 'echo', arguments: { text: 'hi', context: 'checking adoption' } })
  const conversationId = conversationIdOf(first.json?.result)
  await rpc('tools/call', {
    name: 'fail_always',
    arguments: conversationId ? { conversation_id: conversationId } : {},
  })
  await sleep(150)

  const { events, warnings } = await (await fetch(`${inspect}/__events`)).json()
  const toolCalls = events.filter((e) => e.event === '$mcp_tool_call')
  const echoCall = toolCalls.find((e) => e.properties?.$mcp_tool_name === 'echo')
  const failCall = toolCalls.find((e) => e.properties?.$mcp_tool_name === 'fail_always')
  // A 2026-era tools/list precedes the first conversation handle, so it cannot join the session.
  const anchored = [...toolCalls, ...events.filter((e) => e.event === '$mcp_initialize')]
  const sessions = new Set(anchored.map((e) => e.properties?.$session_id))

  check('server answers tools/list', list.status === 200 && !!echoTool)
  check('tool result reaches the client', first.json?.result?.content?.[0]?.text === 'hi')
  check('instrument() logged no warning', warnings.length === 0, warnings[0] ?? '')
  check(
    '$mcp_tools_list captured',
    events.some((e) => e.event === '$mcp_tools_list')
  )
  check('$mcp_tool_call captured', !!echoCall)
  check('thrown error recorded as an error', failCall?.properties?.$mcp_is_error === true)
  check('error message is clean', failCall?.properties?.$mcp_error_message === 'intentional failure')
  check('context parameter advertised', !!echoTool?.inputSchema?.properties?.context)
  check('$mcp_intent captured', echoCall?.properties?.$mcp_intent === 'checking adoption')
  check('context stripped before the tool ran', first.json?.result?.content?.[0]?.text === 'hi')
  check('identify() resolved the user', echoCall?.distinctId === `user_${TOKEN}`, `distinct_id=${echoCall?.distinctId}`)
  check('client name recorded', echoCall?.properties?.$mcp_client_name === CLIENT.name)
  check('protocol version recorded', !!echoCall?.properties?.$mcp_protocol_version)
  check('one session across the conversation', sessions.size === 1, `${sessions.size} session ids`)
  if (era === 'modern') {
    check('no Mcp-Session-Id on a 2026-era response', !first.headers.get('mcp-session-id'))
  }
}

function boot(env) {
  const child = spawn(process.execPath, [framework.server], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    env: { ...process.env, PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  process.on('exit', () => child.kill('SIGKILL'))
  const urls = new Promise((resolve) => {
    let out = ''
    child.stdout.on('data', (d) => {
      out += d
      // A framework that owns its HTTP server serves the recorder on a second port.
      const m = out.match(/MCP_HARNESS_LISTENING port=(\d+)(?: inspect=(\d+))?/)
      if (m) {
        const base = `http://localhost:${m[1]}`
        resolve({ base, inspect: m[2] ? `http://localhost:${m[2]}` : base })
      }
    })
    child.on('exit', () => resolve(null))
    setTimeout(() => resolve(null), 60000)
  })
  return { child, urls }
}

for (const row of framework.rows) {
  const { child, urls } = boot(row.env)
  const resolved = await urls
  if (!resolved) {
    console.error(`${RED}no verdict:${RESET} ${row.label} never announced a port`)
    process.exit(1)
  }
  for (const era of framework.eras) {
    await runEra(resolved, row, era)
  }
  child.kill('SIGKILL')
}

const key = (f) => `${f.row} · ${f.era} · ${f.name}`
const expected = new Set(
  JSON.parse(readFileSync(new URL('./expected-failures.json', import.meta.url), 'utf8'))
    .filter((f) => f.framework === frameworkName)
    .map(key)
)
const failing = new Set(results.filter((r) => !r.ok).map(key))
const regressed = [...failing].filter((k) => !expected.has(k))
const nowPassing = [...expected].filter((k) => !failing.has(k))

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed (${expected.size} expected failure(s))`)
if (regressed.length > 0) console.error(`${RED}regressed:${RESET} ${regressed.join(' · ')}`)
if (nowPassing.length > 0) {
  console.error(`${GREEN}now passing — remove from expected-failures.json:${RESET} ${nowPassing.join(' · ')}`)
}
process.exit(regressed.length === 0 && nowPassing.length === 0 ? 0 : 1)

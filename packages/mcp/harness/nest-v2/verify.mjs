// Acceptance test for the stack reported in posthog-js#4449:
// NestJS + @rekog/mcp-nest 2.0.0 + MCP SDK v2, stateless streamable HTTP.
//
//   node verify.mjs                 # both eras, LEVEL=high
//   LEVEL=low node verify.mjs       # the instrument(server.server) workaround
//
// The server binds an ephemeral port (PORT=0) and announces it on stdout; set
// PORT explicitly to pin one for manual runs.
//
// Known-broken assertions live in expected-failures.json. The run passes iff the
// failing set EXACTLY matches that file — a regression fails, and so does an
// unexpected improvement (remove the entry to ratchet it in). A floor would let
// a regression hide behind a coincidental improvement.
//
// Raw JSON-RPC over fetch, never the SDK Client — a stock v2 Client negotiates
// the LEGACY era and would report green having tested none of 2026-07-28.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
let currentEra = ''
function check(name, ok, detail = '') {
    results.push({ era: currentEra, name, ok })
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

/**
 * A 2026-era (modern) request needs ALL of: params._meta carrying
 * protocolVersion, clientInfo AND clientCapabilities; an Mcp-Method header; and
 * an Mcp-Name header for tools/call. Omitting clientCapabilities returns
 * -32602 "Invalid _meta envelope".
 */
function modernHeaders(method, name) {
    return {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${TOKEN}`,
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(name ? { 'mcp-name': name } : {}),
    }
}

function modernMeta() {
    return {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'acceptance-client', version: '9.9' },
        'io.modelcontextprotocol/clientCapabilities': {},
    }
}

// A real client replays the Mcp-Session-Id it was handed on every later request.
// Without this the harness reports a session/identity failure that no real client
// would see: on a stateless server the replayed token is the ONLY thing carrying
// client info and the negotiated protocol version between per-request instances.
let sessionId

let id = 0
async function rpc(era, method, params = {}, name) {
    const body =
        era === 'modern'
            ? { jsonrpc: '2.0', id: ++id, method, params: { ...params, _meta: modernMeta() } }
            : { jsonrpc: '2.0', id: ++id, method, params }
    const headers = era === 'modern' ? modernHeaders(method, name) : legacyHeaders()
    if (sessionId) headers['mcp-session-id'] = sessionId
    const res = await fetch(`${BASE}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) })
    // 2026-07-28 removed sessions from the protocol, so a modern response has no
    // header to capture — the `if` is what keeps that an absence, not a bug.
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

async function runEra(era) {
    console.log(`\n${era === 'modern' ? '2026-07-28 (modern)' : '2025-11-25 (legacy)'} · LEVEL=${LEVEL}`)
    currentEra = era
    sessionId = undefined
    await resetState()

    if (era === 'legacy') {
        await rpc('legacy', 'initialize', {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'acceptance-client', version: '9.9' },
        })
    }

    const list = await rpc(era, 'tools/list')
    const tools = list.json?.result?.tools ?? []
    const echoTool = tools.find((t) => t.name === 'echo')

    const call = await rpc(era, 'tools/call', { name: 'echo', arguments: { text: 'hi' } }, 'echo')
    await rpc(era, 'tools/call', { name: 'fail_always', arguments: {} }, 'fail_always')

    await sleep(150)
    const { events, warnings, extraShapes = [] } = await readState()
    const toolCalls = events.filter((e) => e.event === '$mcp_tool_call')
    const listings = events.filter((e) => e.event === '$mcp_tools_list')
    const echoCall = toolCalls.find((e) => e.properties?.$mcp_tool_name === 'echo')
    const failCall = toolCalls.find((e) => e.properties?.$mcp_tool_name === 'fail_always')

    // --- the server still works at all (regression floor) ---
    check('host server answers tools/list', list.status === 200 && tools.length > 0, `${tools.length} tools`)
    check('host server answers tools/call', call.status === 200, `HTTP ${call.status}`)
    check('tool result is correct', call.json?.result?.content?.[0]?.text === 'hi')

    // --- Milestone A: it captures at all ---
    check('instrument() logged no warning', warnings.length === 0, warnings[0] ?? '')
    check('$mcp_tools_list captured', listings.length >= 1, `got ${listings.length}`)
    check('$mcp_tool_call captured for echo', !!echoCall)
    check('$mcp_tool_call captured for fail_always', !!failCall)
    check('error call recorded as an error', failCall?.properties?.$mcp_is_error === true)
    check(
        'error message is clean',
        failCall?.properties?.$mcp_error_message === 'intentional failure',
        JSON.stringify(failCall?.properties?.$mcp_error_message),
    )

    // --- the injected context parameter reaches the wire ---
    check('context parameter advertised on tools/list', !!echoTool?.inputSchema?.properties?.context)
    check(
        'conversation_id advertised on tools/list',
        !!echoTool?.inputSchema?.properties?.conversation_id,
    )

    // --- Milestone B: identity ---
    check(
        'identify() resolved a user',
        echoCall?.distinctId === `user_${TOKEN}`,
        `distinct_id=${echoCall?.distinctId}`,
    )
    // ADR-0006: host callbacks get the SDK's own `extra`, unnormalised. A
    // synthesised `requestInfo` on v2 would be a convincing partial lie, so its
    // absence is the assertion — previously proved only by letting a v1-shaped
    // identify() fail, which cost four assertions and asserted nothing directly.
    check(
        'extra is not normalised to the v1 shape',
        extraShapes.length > 0 && extraShapes.every((s) => !s.hasRequestInfo),
        `${extraShapes.length} observed, ${extraShapes.filter((s) => s.hasRequestInfo).length} with requestInfo`,
    )
    check(
        'getRequestHeaders() resolves headers on v2',
        extraShapes.length > 0 && extraShapes.every((s) => s.headersResolved),
        `${extraShapes.filter((s) => s.headersResolved).length}/${extraShapes.length}`,
    )
    check('client name recorded', !!echoCall?.properties?.$mcp_client_name, echoCall?.properties?.$mcp_client_name)
    check(
        'protocol version recorded',
        !!echoCall?.properties?.$mcp_protocol_version,
        echoCall?.properties?.$mcp_protocol_version,
    )

    // --- Milestone C: ownership on a per-request instance ---
    const intentCall = await rpc(
        era,
        'tools/call',
        { name: 'echo', arguments: { text: 'hi', context: 'checking adoption numbers' } },
        'echo',
    )
    await sleep(150)
    const after = await readState()
    const withIntent = after.events
        .filter((e) => e.event === '$mcp_tool_call')
        .find((e) => e.properties?.$mcp_intent)
    check(
        '$mcp_intent captured from the context argument',
        withIntent?.properties?.$mcp_intent === 'checking adoption numbers',
        JSON.stringify(withIntent?.properties?.$mcp_intent),
    )
    check(
        'context argument stripped before the tool ran',
        intentCall.json?.result?.content?.[0]?.text === 'hi',
        JSON.stringify(intentCall.json?.result?.content?.[0]?.text),
    )

    // --- spec: no session header on a modern-era response ---
    if (era === 'modern') {
        check('no Mcp-Session-Id on a 2026-era response', !call.headers.get('mcp-session-id'))
    }
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

await runEra('legacy')
await runEra('modern')

killServer()

// ── expected-failures reconciliation ────────────────────────────────────────
const key = (f) => `${f.era} · ${f.name}`
const expected = new Set(
    JSON.parse(readFileSync(new URL('./expected-failures.json', import.meta.url), 'utf8')).map(key)
)
const failing = new Set(results.filter((r) => !r.ok).map(key))
const regressed = [...failing].filter((k) => !expected.has(k))
const nowPassing = [...expected].filter((k) => !failing.has(k))

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} passed (${expected.size} expected failure(s))`)
if (regressed.length > 0) {
    console.error(`${RED}regressed:${RESET} ${regressed.join(' · ')}`)
}
if (nowPassing.length > 0) {
    console.error(
        `${GREEN}now passing — remove from expected-failures.json:${RESET} ${nowPassing.join(' · ')}`
    )
}
process.exit(regressed.length === 0 && nowPassing.length === 0 ? 0 : 1)

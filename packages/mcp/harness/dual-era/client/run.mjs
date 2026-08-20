// Raw JSON-RPC over fetch. Not the SDK Client — a stock v2 Client negotiates the
// LEGACY era and would report green having tested none of 2026-07-28.
//
//   node client/run.mjs --url http://localhost:<port> --sdk v2 --lane 2026 [--conv on|off] [--json]
//
// Emits the matrix assertions. --json prints one machine-readable line for
// matrix.mjs; without it, a human-readable list.

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`)
    return i === -1 ? fallback : argv[i + 1]
}
const URL_BASE = arg('url', 'http://localhost:3222')
// Which SDK major serves the URL. Some assertions are era/major-conditional and
// this cannot be sniffed off the wire (that ambiguity is the point of the tests).
const SDK = arg('sdk', 'v2') === 'v1' ? 'v1' : 'v2'
const LANE = arg('lane', '2025') === '2026' ? '2026' : '2025'
const CONV = arg('conv', 'off') === 'on'
const AS_JSON = argv.includes('--json')
// What this configuration requires of the mcp-session-id response header:
//   none    2026-07-28 forbids minting one
//   token   v1 stateless — @posthog/mcp mints its own self-encoded token
//   present v1 stateful  — the transport mints an opaque id
const HEADER_EXPECT = arg('header', 'none')
const ECHO = process.env.ECHO !== '0'

const MODERN = '2026-07-28'
const LEGACY = '2025-11-25'
const CLIENT_INFO = { name: 'dual-era-testbed', version: '1.0.0' }
const INTENT = 'checking adoption numbers'
const META = {
    protocolVersion: 'io.modelcontextprotocol/protocolVersion',
    clientInfo: 'io.modelcontextprotocol/clientInfo',
    clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
}
/** Methods whose Mcp-Name header must mirror a params field (2026-07-28 wire rule). */
const NAME_HEADER_SOURCE = { 'tools/call': 'name', 'prompts/get': 'name', 'resources/read': 'uri' }

let id = 0
let sessionHeader
const seenSessionHeaders = []

async function rpc(method, params = {}) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    let body

    if (LANE === '2026') {
        body = {
            jsonrpc: '2.0',
            id: ++id,
            method,
            params: {
                ...params,
                _meta: {
                    [META.protocolVersion]: MODERN,
                    [META.clientInfo]: CLIENT_INFO,
                    [META.clientCapabilities]: {},
                },
            },
        }
        headers['mcp-protocol-version'] = MODERN
        headers['mcp-method'] = method
        const nameField = NAME_HEADER_SOURCE[method]
        if (nameField && typeof params[nameField] === 'string') headers['mcp-name'] = params[nameField]
    } else {
        body = { jsonrpc: '2.0', id: ++id, method, params }
        if (sessionHeader) headers['mcp-session-id'] = sessionHeader
        // 2025-11-25 requires the negotiated version on every request after
        // initialize. A real client sends it; without it this lane silently
        // tested a client that does not exist.
        if (method !== 'initialize') headers['mcp-protocol-version'] = LEGACY
    }

    const res = await fetch(`${URL_BASE}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) })
    const got = res.headers.get('mcp-session-id')
    seenSessionHeaders.push({ method, header: got })
    if (got && !sessionHeader) sessionHeader = got

    const text = await res.text()
    if (!text) return { status: res.status }
    const payload =
        text.startsWith('event:') || text.startsWith('data:')
            ? JSON.parse(
                  text
                      .split('\n')
                      .find((l) => l.startsWith('data:'))
                      .slice(5)
                      .trim()
              )
            : JSON.parse(text)
    return { status: res.status, ...payload }
}

async function notify(method, params = {}) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    if (sessionHeader) headers['mcp-session-id'] = sessionHeader
    await fetch(`${URL_BASE}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    })
}

const textOf = (r) => (r?.result?.content ?? []).map((c) => c.text ?? '').join('\n')

/**
 * Pull the conversation handle out of a tool result.
 *
 * The handle arrives as data — a `{"conversation_id":"…"}` text block (#4542) —
 * because an imperative sentence in tool output is indistinguishable from prompt
 * injection to a hardened client. Match on the handle, never on the wording: a
 * fixture that pins the sentence turns an intended wire-format change into a red
 * cell indistinguishable from a regression.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const HANDLE_PATTERN = new RegExp(`"conversation_id"\\s*:\\s*"(${UUID})"`, 'i')
const handleFrom = (r) => textOf(r).match(HANDLE_PATTERN)?.[1]

async function scenario() {
    await fetch(`${URL_BASE}/__reset`).catch(() => {})

    if (LANE === '2025') {
        await rpc('initialize', { protocolVersion: LEGACY, capabilities: {}, clientInfo: CLIENT_INFO })
        await notify('notifications/initialized')
    }

    const list = await rpc('tools/list')
    const first = await rpc('tools/call', { name: 'echo', arguments: { text: 'one' } })
    const handle = handleFrom(first)
    const withHandle = (extra) => (ECHO && handle ? { ...extra, conversation_id: handle } : extra)

    // The second echo carries the injected `context` parameter — an agent stating
    // its intent. The tool must still answer correctly with the extra argument on
    // the wire, and $mcp_intent must be captured from it.
    const second = await rpc('tools/call', {
        name: 'echo',
        arguments: withHandle({ text: 'two', context: INTENT }),
    })
    await rpc('tools/call', { name: 'add', arguments: withHandle({ a: 2, b: 3 }) })
    await rpc('tools/call', { name: 'fail_always', arguments: withHandle({}) })

    const state = await fetch(`${URL_BASE}/__events`).then((r) => r.json())
    return { list, second, handle, ...state }
}

// ── the assertions ──────────────────────────────────────────────────────────
const r = await scenario()
const ev = r.events ?? []
const of = (t) => ev.filter((e) => e.event === t)
const toolCalls = of('$mcp_tool_call')
const p = (e, k) => e?.properties?.[k]

const errCall = toolCalls.find((e) => p(e, '$mcp_tool_name') === 'fail_always')
const callSessions = new Set(toolCalls.map((e) => p(e, '$session_id')).filter(Boolean))
const echoTool = (r.list?.result?.tools ?? []).find((t) => t.name === 'echo')
const advertises = Object.keys(echoTool?.inputSchema?.properties ?? {}).includes('conversation_id')
const isV2 = SDK === 'v2'

function decodesAsOurToken(value) {
    if (!value) return false
    try {
        const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
        return typeof payload?.sid === 'string' && payload.sid.startsWith('ses_')
    } catch {
        return false
    }
}
const mintedHeaders = seenSessionHeaders.map((s) => s.header).filter(Boolean)
const headerOk =
    HEADER_EXPECT === 'none'
        ? mintedHeaders.length === 0
        : HEADER_EXPECT === 'token'
          ? mintedHeaders.length > 0 && decodesAsOurToken(mintedHeaders[0])
          : mintedHeaders.length > 0

const results = {
    calls:
        toolCalls.length === 4 &&
        toolCalls.map((e) => p(e, '$mcp_tool_name')).join(',') === 'echo,echo,add,fail_always',
    // Subsumes the old 'message' column: an error is only captured correctly if its
    // message is clean — no conversation_id prompt-back concatenated into it.
    errors:
        p(errCall, '$mcp_is_error') === true &&
        of('$exception').length >= 1 &&
        p(errCall, '$mcp_error_message') === 'intentional failure',
    // The agent stated its intent via the injected `context` parameter: it must be
    // captured as $mcp_intent, and the tool must still have answered correctly with
    // the extra argument on the wire.
    intent: toolCalls.some((e) => p(e, '$mcp_intent') === INTENT) && textOf(r.second) === 'two',
    // The flag must visibly take effect: advertised iff enabled.
    schema: advertises === CONV,
    session: isV2 && !CONV ? null : toolCalls.length > 0 && callSessions.size === 1,
    client:
        toolCalls.length > 0 &&
        toolCalls.every((e) => p(e, '$mcp_client_name') === CLIENT_INFO.name && p(e, '$mcp_client_version') === CLIENT_INFO.version),
    protocol:
        toolCalls.length > 0 &&
        toolCalls.every((e) => p(e, '$mcp_protocol_version') === (LANE === '2026' ? MODERN : LEGACY)),
    warnings: (r.warnings ?? []).length === 0,
    header: headerOk,
    alive: null, // measured by matrix.mjs in a separate boot
}

if (AS_JSON) {
    console.log(JSON.stringify({ results, events: ev.length, warning: (r.warnings ?? [])[0] ?? null }))
} else {
    for (const [k, v] of Object.entries(results)) {
        console.log(`  ${v === null ? ' · ' : v ? '\x1b[32m ✓ \x1b[0m' : '\x1b[31m ✗ \x1b[0m'} ${k}`)
    }
    if ((r.warnings ?? [])[0]) console.log(`\n  warning: ${r.warnings[0]}`)
}
process.exit(Object.values(results).some((v) => v === false) ? 1 : 0)

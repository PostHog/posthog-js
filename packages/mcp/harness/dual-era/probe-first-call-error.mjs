// C1 probe — the case the matrix does not cover.
//
// The matrix drives four tool calls and fails on the LAST one, echoing the
// conversation handle it received on the first. So `minted` is false by the time
// `fail_always` runs, no prompt-back is appended to that result, and there is
// nothing to pollute the error message with — the matrix's `errors` column
// asserts a clean message and passes without ever exercising the bug.
//
// The pollution needs the FIRST call of a conversation to fail: that is the call
// that mints the handle, appends it to the result, and — before the fix — read
// the captured error back out of the appended copy, splicing a fresh uuid into
// $mcp_error_message on every failure. (Since 0.11.7 the handle is appended as
// `{"conversation_id":"…"}` rather than an imperative sentence; the ordering bug
// this probe covers is independent of which form it takes.)
//
// A tool failing on the first call of a conversation is not a corner case: it is
// what an agent hits on a bad argument, an expired token, or a cold dependency.
//
// v2 only, and not for convenience: on v1 the thrown error is stashed by the
// tool-callback wrapper and captured from there, so the appended result is never
// read and the bug cannot occur. v2 flattens the throw into an `isError` result
// before our wrapper sees it, which is what makes that result the only
// description of the failure — and therefore what exposes the pollution.
//
//   node probe-first-call-error.mjs
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { McpServer as V2McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { instrument } from '@posthog/mcp'
import { TOOLS, TOOL_BY_NAME } from './shared/tools.mjs'
import { createRecorder } from './shared/posthog.mjs'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? GREEN + '✓' : RED + '✗'}${RESET} ${name}${detail ? `  ${detail}` : ''}`)
}

/**
 * The high-level server on both majors. Ownership of `conversation_id` is read
 * from the tool registry there, which is what lets a handle be minted at all —
 * on a low-level server it is learned from a `tools/list` this instance served,
 * so a cold per-request instance never mints one and the bug is unreachable.
 */
function registerAll(server) {
  for (const t of TOOLS) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.inputShape }, t.handler)
  }
  return server
}

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'probe', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

async function post(port, body, headers = {}) {
  const res = await fetch(`http://localhost:${port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, text: await res.text() }
}

/**
 * Does the response carry a conversation handle?
 *
 * The handle is returned as data — `{"conversation_id":"…"}` (#4542) — rather
 * than as an imperative sentence a hardened client reads as prompt injection.
 * Assert the handle reached the caller, not the sentence carrying it.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const HANDLE = new RegExp(`conversation_id"\\s*:\\s*"${UUID}`, 'i')

/** `responseText` is a raw HTTP body, so the handle's own JSON arrives escaped. */
const deliversHandle = (responseText) => HANDLE.test(responseText.replace(/\\"/g, '"'))

/** Both assertions matter, and they pull in opposite directions. */
function assertBoth(label, recorder, responseText) {
  const call = recorder.events.filter((e) => e.event === '$mcp_tool_call').at(-1)
  const message = call?.properties?.$mcp_error_message
  check(`${label} · error captured`, call?.properties?.$mcp_is_error === true)
  check(`${label} · $mcp_error_message is clean`, message === 'intentional failure', JSON.stringify(message))
  // The agent must still receive the handle on a failed call — otherwise the
  // retry opens a new conversation and the failure and its fix land in
  // different sessions. Fixing the message by withholding it would be worse.
  check(`${label} · handle still delivered to the caller`, deliversHandle(responseText))
}

// ── v2, high-level, modern era, conversation ids on ─────────────────────────
async function probeV2() {
  console.log('\nv2 · first call of the conversation fails · modern era · conv=on')
  const recorder = createRecorder('probe:v2')
  const handler = createMcpHandler(
    () => {
      const server = registerAll(new V2McpServer({ name: 'probe-v2', version: '1.0.0' }))
      instrument(server, recorder.client, { logger: recorder.logger, enableConversationId: true })
      return server
    },
    { responseMode: 'json', onerror: (e) => recorder.logger(`handler error: ${e}`) }
  )
  const node = toNodeHandler(handler)
  const http = createServer((req, res) => node(req, res)).listen(0)
  await sleep(300)
  const port = http.address().port
  try {
    // No tools/list first, and no handle supplied: this call mints one.
    const call = await post(
      port,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'fail_always', arguments: {}, _meta: MODERN_META },
      },
      { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'fail_always' }
    )
    await sleep(200)
    assertBoth('v2', recorder, call.text)
  } finally {
    http.close()
    await sleep(150)
  }
}

await probeV2()

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)

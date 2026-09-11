import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'

import { McpServer, Server, createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { z } from 'zod4'
import { instrument } from '@posthog/mcp'

const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'defaults-probe', version: '1' },
}
for (const level of ['high', 'low']) {
  const events = []
  const received = []
  const client = { capture: (event) => events.push(event), flush: async () => {}, shutdown: async () => {} }
  const handler = createMcpHandler(
    () => {
      const run = (args) => {
        received.push(args)
        return { content: [{ type: 'text', text: 'ok' }] }
      }
      const server =
        level === 'high'
          ? new McpServer({ name: 'defaults-probe', version: '1' })
          : new Server({ name: 'defaults-probe', version: '1' }, { capabilities: { tools: {} } })
      if (level === 'high') server.registerTool('echo', { inputSchema: { value: z.string() } }, run)
      else {
        server.setRequestHandler('tools/list', async () => ({
          tools: [
            {
              name: 'echo',
              inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
            },
          ],
        }))
        server.setRequestHandler('tools/call', async (req) => run(req.params.arguments))
      }
      instrument(server, client)
      return server
    },
    { responseMode: 'json' }
  )
  const http = createServer(toNodeHandler(handler)).listen(0, '127.0.0.1')
  await once(http, 'listening')
  let id = 0
  const request = async (method, args, metadata = {}) => {
    const res = await fetch(`http://127.0.0.1:${http.address().port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(method === 'tools/call' ? { 'mcp-name': 'echo' } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++id,
        method,
        params: { ...(args ? { name: 'echo', arguments: args } : {}), _meta: { ...meta, ...metadata } },
      }),
    })
    const body = await res.json()
    assert.equal(res.status, 200, JSON.stringify(body))
    assert.equal(body.error, undefined)
    return body.result
  }
  try {
    const listing = await request('tools/list')
    const properties = listing.tools[0].inputSchema.properties
    for (const key of ['context', 'llm_model', 'conversation_id']) assert.ok(properties[key])
    assert.deepEqual(
      listing.tools.map((tool) => tool.name),
      ['echo']
    )
    const first = await request('tools/call', { value: 'first', context: 'testing defaults', llm_model: 'probe-model' })
    const handle = JSON.stringify(first).match(
      /[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
    )?.[0]
    await request('tools/call', {
      value: 'second',
      context: 'testing defaults',
      llm_model: 'probe-model',
      ...(handle ? { conversation_id: handle } : {}),
    })
    await request(
      'tools/call',
      { value: 'metadata', context: 'testing metadata', llm_model: 'fallback-model' },
      { 'x-codex-turn-metadata': { model: 'metadata-model' } }
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    const calls = events.filter((event) => event.event === '$mcp_tool_call')
    assert.equal(calls.length, 3)
    assert.equal(calls[2].properties.$mcp_llm_model, 'metadata-model')
    assert.ok(handle, 'the first call delivers a conversation handle')
    assert.equal(calls[0].properties.$mcp_llm_model, 'probe-model')
    assert.equal(calls[0].properties.$session_id, calls[1].properties.$session_id)
    assert.deepEqual(received, [{ value: 'first' }, { value: 'second' }, { value: 'metadata' }])
    assert.equal(events.filter((event) => event.event === '$mcp_tools_list').length, 1)

    console.log(
      JSON.stringify(
        {
          level,
          injected: Object.keys(properties),
          handleDelivered: Boolean(handle),
          sessionsMatch: calls[0].properties.$session_id === calls[1].properties.$session_id,
          selfReportedModel: calls[0].properties.$mcp_llm_model ?? null,
          metadataModel: calls[2].properties.$mcp_llm_model,
          received,
        },
        null,
        2
      )
    )
  } finally {
    http.closeAllConnections()
    await new Promise((resolve) => http.close(resolve))
  }
}

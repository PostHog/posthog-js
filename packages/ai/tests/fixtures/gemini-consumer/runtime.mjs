import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const modern = process.argv[2] === '2.18.0'
const requests = []
const interaction = {
  id: 'consumer_interaction',
  model: 'gemini-synthetic',
  status: 'completed',
  steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Hello' }] }],
  usage: { total_input_tokens: 7, total_output_tokens: 2 },
}
const generated = {
  candidates: [{ content: { role: 'model', parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 },
}
const eventFrame = (event) => `event: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`
const server = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  const parsed = JSON.parse(body)
  requests.push(parsed)
  assert.equal(
    Object.keys(parsed).some((key) => key.startsWith('posthog')),
    false
  )
  if (request.url.startsWith('/v1beta/interactions')) {
    if (modern && parsed.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(
        eventFrame({
          event_type: 'interaction.created',
          interaction: { id: interaction.id, status: 'in_progress' },
        }) +
          eventFrame({ event_type: 'interaction.completed', interaction }) +
          'event: done\ndata: [DONE]\n\n'
      )
    } else {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify(modern ? interaction : { id: 'old_schema', outputs: [{ type: 'text', text: 'Old' }] })
      )
    }
  } else if (request.url.includes('streamGenerateContent')) {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify(generated)}\n\n`)
  } else {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify(
        request.url.includes('batchEmbedContents')
          ? { embeddings: [{ values: [0.25, 0.5] }] }
          : request.url.includes(':embedContent')
            ? { embedding: { values: [0.25, 0.5] } }
            : generated
      )
    )
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`
try {
  for (const module of [await import('@posthog/ai/gemini'), require('@posthog/ai/gemini')]) {
    const events = []
    const posthog = { capture: (event) => events.push(event), privacy_mode: false }
    const client = new module.default({
      apiKey: 'local-test-key',
      vertexai: false,
      httpOptions: { baseUrl, apiVersion: 'v1beta', timeout: 2000, retryOptions: { attempts: 1 } },
      posthog,
    })
    assert.equal(
      (
        await client.models.generateContent({
          model: 'gemini-synthetic',
          contents: 'Hello',
          posthogDistinctId: 'consumer',
        })
      ).text,
      'Hello'
    )
    const chunks = []
    for await (const chunk of client.models.generateContentStream({ model: 'gemini-synthetic', contents: 'Hello' }))
      chunks.push(chunk.text)
    assert.deepEqual(chunks, ['Hello'])
    assert.deepEqual(
      (await client.models.embedContent({ model: 'gemini-synthetic', contents: 'Hello' })).embeddings[0].values,
      [0.25, 0.5]
    )
    if (modern) {
      const result = await client.interactions.create({ model: 'gemini-synthetic', input: 'Hello' })
      assert.equal(result.id, interaction.id)
      assert.deepEqual(result.usage, interaction.usage)
      const stream = await client.interactions.create({ model: 'gemini-synthetic', input: 'Hello', stream: true })
      assert.equal(typeof stream.getReader, 'function')
      const received = []
      for await (const event of stream) received.push(event.event_type)
      assert.deepEqual(received, ['interaction.created', 'interaction.completed'])
      assert.equal(events.length, 5)
      assert.equal(events.at(-1).properties.$ai_input_tokens, 7)
      assert.equal(events.at(-1).properties.$ai_output_tokens, 2)
    } else {
      await assert.rejects(
        client.interactions.create({ model: 'gemini-synthetic', input: 'Hello' }),
        /2\.18\.0 or newer/
      )
      assert.equal(events.length, 4)
    }
  }
  process.stdout.write(`SDK ${process.argv[2]} ESM/CJS installed consumer passed (${requests.length} local requests)\n`)
} finally {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const requests = []
const usage = { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 }
const completion = {
  id: 'chatcmpl_consumer',
  object: 'chat.completion',
  created: 0,
  model: 'gpt-synthetic',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop', logprobs: null }],
  usage,
}
const chunk = (delta, extra = {}) => ({
  id: 'chatcmpl_consumer',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'gpt-synthetic',
  choices: [{ index: 0, delta, finish_reason: null, logprobs: null }],
  ...extra,
})
const response = {
  id: 'resp_consumer',
  object: 'response',
  created_at: 0,
  status: 'completed',
  model: 'gpt-synthetic',
  output: [
    {
      type: 'message',
      id: 'msg_consumer',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello', annotations: [] }],
    },
  ],
  usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 },
}
const vector = [0.25, 0.5]
const base64Vector = Buffer.from(new Float32Array(vector).buffer).toString('base64')

const server = createServer(async (request, res) => {
  let body = ''
  for await (const part of request) body += part
  const parsed = JSON.parse(body)
  requests.push(parsed)
  assert.equal(
    Object.keys(parsed).some((key) => key.startsWith('posthog')),
    false
  )
  if (request.url.endsWith('/chat/completions') && parsed.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(
      [chunk({ role: 'assistant', content: 'Hel' }), chunk({ content: 'lo' }), { ...chunk({}), choices: [], usage }]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join('') + 'data: [DONE]\n\n'
    )
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  if (request.url.endsWith('/chat/completions')) res.end(JSON.stringify(completion))
  else if (request.url.endsWith('/responses')) res.end(JSON.stringify(response))
  else if (request.url.endsWith('/embeddings'))
    res.end(
      JSON.stringify({
        object: 'list',
        model: 'embedding-synthetic',
        data: [
          { object: 'embedding', index: 0, embedding: parsed.encoding_format === 'base64' ? base64Vector : vector },
        ],
        usage: { prompt_tokens: 3, total_tokens: 3 },
      })
    )
  else res.end('{}')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseURL = `http://127.0.0.1:${server.address().port}/v1`

async function waitForEvents(events, count) {
  for (let attempt = 0; attempt < 100 && events.length < count; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(events.length, count)
}

try {
  for (const module of [await import('@posthog/ai/openai'), require('@posthog/ai/openai')]) {
    const events = []
    const posthog = {
      capture: (event) => events.push(event),
      captureImmediate: async (event) => events.push(event),
      privacy_mode: false,
    }
    const client = new module.OpenAI({ apiKey: 'local-test-key', baseURL, maxRetries: 0, timeout: 2000, posthog })

    const result = await client.chat.completions.create({
      model: 'gpt-synthetic',
      messages: [{ role: 'user', content: 'Hello' }],
      posthogDistinctId: 'consumer',
    })
    assert.equal(result.choices[0].message.content, 'Hello')

    const stream = await client.chat.completions.create({
      model: 'gpt-synthetic',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
      stream_options: { include_usage: true },
    })
    let streamed = ''
    for await (const part of stream) streamed += part.choices[0]?.delta.content ?? ''
    assert.equal(streamed, 'Hello')

    assert.equal((await client.responses.create({ model: 'gpt-synthetic', input: 'Hello' })).output_text, 'Hello')

    assert.deepEqual(
      (await client.embeddings.create({ model: 'embedding-synthetic', input: 'Hello' })).data[0].embedding,
      vector
    )
    assert.equal(
      (await client.embeddings.create({ model: 'embedding-synthetic', input: 'Hello', encoding_format: 'base64' }))
        .data[0].embedding,
      base64Vector
    )

    await waitForEvents(events, 5)
    assert.deepEqual(
      events.map((event) => event.event),
      ['$ai_generation', '$ai_generation', '$ai_generation', '$ai_embedding', '$ai_embedding']
    )
    for (const event of events.slice(0, 3)) {
      assert.equal(event.properties.$ai_input_tokens, 7)
      assert.equal(event.properties.$ai_output_tokens, 2)
    }
    assert.equal(events[0].distinctId, 'consumer')
    assert.equal(events[3].properties.$ai_input_tokens, 3)
  }
  process.stdout.write(
    `openai ${process.argv[2]} ESM/CJS installed consumer passed (${requests.length} local requests)\n`
  )
} finally {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}

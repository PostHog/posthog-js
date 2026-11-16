import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { startReplay } from './cassette'
import { startCollector } from './collector'
import { geminiScenario } from './gemini-scenarios.mjs'

const cases = [
  { group: 'interaction', input: 7, output: 9, status: 'completed', text: 'Hello! How can I help you today?' },
  { group: 'interaction-stream', input: 7, output: 9, status: 'completed', text: 'Hello! How can I help you today?' },
  { group: 'interaction-tools', input: 73, output: 20, status: 'requires_action', toolCallId: 'call_867943' },
  { group: 'interaction-tools-stream', input: 73, output: 20, status: 'requires_action', toolCallId: 'call_1249321' },
] as const
const model = 'gemini-3.1-flash-lite'

interface InteractionFrame {
  event_type: string
  interaction?: { model?: string; status?: string; usage?: unknown }
  step?: { type?: string; id?: string; name?: string }
  delta?: { type?: string; text?: string }
}

function frames(chunks: string[]): InteractionFrame[] {
  return chunks.flatMap((chunk) =>
    chunk.split(/\r?\n\r?\n/).flatMap((frame) => {
      const data = frame.match(/^data:\s*(.*)$/m)?.[1]
      return data && data !== '[DONE]' ? [JSON.parse(data) as InteractionFrame] : []
    })
  )
}

it.each(cases)('replays provider-backed Gemini $group through the built SDK and captures usage', async (testCase) => {
  const path = fileURLToPath(new URL(`./fixtures/gemini-${testCase.group}.json`, import.meta.url))
  const cassette = JSON.parse(await readFile(path, 'utf8'))
  expect(cassette.provenance).toMatchObject({ source: 'gemini', providerSdkVersion: '2.18.0' })
  expect(cassette.interactions).toHaveLength(1)
  const recorded = cassette.interactions[0]
  const streaming = testCase.group.endsWith('stream')
  expect(recorded.request).toMatchObject({ method: 'POST', path: '/v1beta/interactions' })
  expect(recorded.request.body).toMatchObject({ model, store: false, ...(streaming ? { stream: true } : {}) })
  expect(recorded.response.body.kind).toBe(streaming ? 'sse' : 'json')
  const events = streaming ? frames(recorded.response.body.chunks) : []
  const terminal = streaming
    ? events.findLast((event) => event.event_type === 'interaction.completed')?.interaction
    : recorded.response.body.value
  expect(terminal).toMatchObject({ status: testCase.status, model })
  expect(terminal.usage).toMatchObject({
    total_input_tokens: testCase.input,
    total_output_tokens: testCase.output,
    total_tokens: testCase.input + testCase.output,
  })
  if (streaming) {
    expect(events.map((event) => event.event_type)).toEqual([
      'interaction.created',
      'interaction.status_update',
      'step.start',
      'step.delta',
      'step.stop',
      'step.start',
      'step.delta',
      'step.stop',
      'interaction.completed',
    ])
    expect(recorded.response.body.chunks.join('')).toContain('event: done\ndata: [DONE]')
  }

  const scenario = geminiScenario(testCase.group, model)
  const replay = await startReplay({ path })
  const collector = await startCollector()
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('./scenarios/gemini.mjs', import.meta.url))],
      {
        env: {
          PROVIDER_URL: replay.url,
          COLLECTOR_URL: collector.url,
          GEMINI_OPERATION: scenario.operation,
          GEMINI_REQUEST: JSON.stringify({ ...scenario.request, posthogTraceId: 'gemini-interaction-cassette-trace' }),
        },
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      }
    )
    await replay.finish()
    collector.verify()
    expect(collector.events).toHaveLength(1)
    const caller = JSON.parse(result.stdout)
    const event = collector.events[0]
    expect(event).toMatchObject({
      event: '$ai_generation',
      distinct_id: 'cassette-test',
      properties: {
        $ai_provider: 'gemini',
        $ai_model: model,
        $ai_trace_id: 'gemini-interaction-cassette-trace',
        $ai_http_status: 200,
        $ai_input_tokens: testCase.input,
        $ai_output_tokens: testCase.output,
        $ai_stop_reason: testCase.status,
        $ai_usage: terminal.usage,
      },
    })
    expect(event.properties.$ai_is_error).toBeUndefined()
    if (streaming) {
      expect(caller.map((item: { event_type: string }) => item.event_type)).toEqual(
        events.map((item) => item.event_type)
      )
      expect(Number.isFinite(event.properties.$ai_time_to_first_token)).toBe(true)
    } else {
      expect(caller.status).toBe(testCase.status)
      expect(caller.usage).toEqual(terminal.usage)
    }

    if ('text' in testCase) {
      const providerText = streaming
        ? events
            .filter((item) => item.event_type === 'step.delta' && item.delta?.type === 'text')
            .map((item) => item.delta.text)
            .join('')
        : terminal.steps
            .flatMap((step: { content?: Array<{ text?: string }> }) => step.content ?? [])
            .map((item: { text?: string }) => item.text ?? '')
            .join('')
      expect(providerText).toBe(testCase.text)
      expect(event.properties.$ai_output_choices).toEqual([
        { role: 'assistant', content: [{ type: 'text', text: testCase.text }] },
      ])
    } else {
      const call = streaming
        ? events.find((item) => item.event_type === 'step.start' && item.step?.type === 'function_call')?.step
        : terminal.steps.find((step: { type: string }) => step.type === 'function_call')
      expect(call).toMatchObject({ id: testCase.toolCallId, name: 'describe_shape' })
      expect(event.properties.$ai_tools).toEqual([{ type: 'function', name: 'describe_shape' }])
      expect(event.properties.$ai_output_choices).toEqual([
        {
          role: 'assistant',
          content: [
            {
              type: 'function',
              id: testCase.toolCallId,
              function: { name: 'describe_shape', arguments: { color: 'blue', sides: 3 } },
            },
          ],
        },
      ])
    }
  } finally {
    await replay.close()
    await collector.close()
  }
})

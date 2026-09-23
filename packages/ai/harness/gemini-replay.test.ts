import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { startReplay } from './cassette'
import { startCollector } from './collector'
import { geminiScenario } from './gemini-scenarios.mjs'

const cases = [
  { group: 'generate', model: 'gemini-3.1-flash-lite', input: 7, output: 9, text: 'Hello! How can I help you today?' },
  { group: 'stream', model: 'gemini-3.1-flash-lite', input: 7, output: 9, text: 'Hello! How can I help you today?' },
  { group: 'tools', model: 'gemini-3.1-flash-lite', input: 67, output: 20, toolCallId: 'call_649034' },
  { group: 'tools-stream', model: 'gemini-3.1-flash-lite', input: 67, output: 20, toolCallId: 'call_388245' },
  { group: 'embed', model: 'gemini-embedding-001' },
] as const

function providerResponses(body: { kind: string; value?: Record<string, unknown>; chunks?: string[] }) {
  if (body.kind === 'json') return [body.value!]
  return body.chunks!.flatMap((chunk) =>
    chunk
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice(5)) as Record<string, unknown>)
  )
}

it.each(cases)('captures provider-backed Gemini $group through the built SDKs', async (testCase) => {
  const path = fileURLToPath(new URL(`./fixtures/gemini-${testCase.group}.json`, import.meta.url))
  const cassette = JSON.parse(await readFile(path, 'utf8'))
  expect(cassette.provenance).toMatchObject({ source: 'gemini', providerSdkVersion: '1.52.0' })
  expect(cassette.interactions).toHaveLength(1)
  const interaction = cassette.interactions[0]
  const recorded = providerResponses(interaction.response.body)
  const scenario = geminiScenario(testCase.group, testCase.model)
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
          GEMINI_REQUEST: JSON.stringify({ ...scenario.request, posthogTraceId: 'gemini-cassette-trace' }),
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
    const properties = event.properties
    expect(event).toMatchObject({
      event: testCase.group === 'embed' ? '$ai_embedding' : '$ai_generation',
      distinct_id: 'cassette-test',
      properties: {
        $ai_provider: 'gemini',
        $ai_model: testCase.model,
        $ai_trace_id: 'gemini-cassette-trace',
        $ai_http_status: 200,
      },
    })
    expect(properties.$ai_is_error).toBeUndefined()

    if (testCase.group === 'embed') {
      const embeddings = recorded[0].embeddings as Array<{ values: number[] }>
      expect(embeddings).toHaveLength(2)
      expect(embeddings.every((embedding) => embedding.values.length === 8)).toBe(true)
      expect(caller.embeddings).toEqual(embeddings)
      expect(properties).toMatchObject({ $ai_input_tokens: 0, $ai_output_choices: null })
      expect(JSON.stringify(event)).not.toContain(JSON.stringify(embeddings[0].values))
      expect(JSON.stringify(event)).not.toContain(JSON.stringify(embeddings[1].values))
      return
    }

    const final = recorded.findLast((response) =>
      (response.candidates as Array<{ finishReason?: string }> | undefined)?.some((candidate) => candidate.finishReason)
    )!
    const usage = recorded.findLast((response) => response.usageMetadata)?.usageMetadata
    expect(final.candidates).toMatchObject([{ finishReason: 'STOP' }])
    expect(usage).toMatchObject({
      promptTokenCount: testCase.input,
      candidatesTokenCount: testCase.output,
    })
    expect(properties).toMatchObject({
      $ai_input_tokens: testCase.input,
      $ai_output_tokens: testCase.output,
      $ai_stop_reason: 'STOP',
      $ai_usage: usage,
    })
    expect(properties.$ai_cache_read_input_tokens).toBeUndefined()
    expect(properties.$ai_reasoning_tokens).toBeUndefined()

    if ('text' in testCase) {
      expect(caller.text).toBe(testCase.text)
      expect(properties.$ai_output_choices).toEqual([
        { role: 'assistant', content: [{ type: 'text', text: testCase.text }] },
      ])
      if (scenario.operation === 'generateContentStream') {
        expect(caller.chunks).toHaveLength(recorded.length)
        expect(Number.isFinite(properties.$ai_time_to_first_token)).toBe(true)
        expect(properties.$ai_time_to_first_token).toBeGreaterThanOrEqual(0)
      } else {
        expect(caller.usageMetadata).toEqual(usage)
      }
      return
    }

    const calls = recorded.flatMap((response) =>
      ((response.candidates as Array<{ content?: { parts?: Array<{ functionCall?: unknown }> } }> | undefined) ?? [])
        .flatMap((candidate) => candidate.content?.parts ?? [])
        .flatMap((part) => (part.functionCall ? [part.functionCall] : []))
    )
    expect(calls).toEqual([{ id: testCase.toolCallId, name: 'describe_shape', args: { color: 'blue', sides: 3 } }])
    const returnedCalls = (scenario.operation === 'generateContentStream' ? caller.chunks : [caller]).flatMap(
      (chunk: { candidates?: Array<{ content?: { parts?: Array<{ functionCall?: unknown }> } }> }) =>
        (chunk.candidates ?? [])
          .flatMap((candidate) => candidate.content?.parts ?? [])
          .flatMap((part) => (part.functionCall ? [part.functionCall] : []))
    )
    expect(returnedCalls).toEqual(calls)
    expect(properties.$ai_tools).toEqual(scenario.request.config.tools)
    expect(properties.$ai_output_choices).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'function', function: { name: 'describe_shape', arguments: { color: 'blue', sides: 3 } } }],
      },
    ])
    if (scenario.operation === 'generateContentStream') {
      expect(caller.chunks).toHaveLength(recorded.length)
      expect(Number.isFinite(properties.$ai_time_to_first_token)).toBe(true)
      expect(properties.$ai_time_to_first_token).toBeGreaterThanOrEqual(0)
    } else {
      expect(caller.usageMetadata).toEqual(usage)
    }
  } finally {
    await replay.close()
    await collector.close()
  }
})

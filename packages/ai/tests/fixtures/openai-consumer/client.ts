import { OpenAI as PostHogOpenAI, AzureOpenAI as PostHogAzureOpenAI } from '@posthog/ai/openai'
import type OpenAI from 'openai'
import type { PostHog } from 'posthog-node'

declare const posthog: PostHog
const client = new PostHogOpenAI({ apiKey: 'consumer-fixture', posthog })
const azure = new PostHogAzureOpenAI({
  apiKey: 'consumer-fixture',
  endpoint: 'https://consumer-fixture.openai.azure.com',
  apiVersion: '2024-10-21',
  posthog,
})

async function calls() {
  const completion: OpenAI.ChatCompletion = await client.chat.completions.create({
    model: 'gpt-synthetic',
    messages: [{ role: 'user', content: 'Hello' }],
    posthogDistinctId: 'consumer',
  })
  const chunks = await client.chat.completions.create({
    model: 'gpt-synthetic',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: true,
    posthogTraceId: 'trace',
  })
  for await (const chunk of chunks) {
    const delta: string | null | undefined = chunk.choices[0]?.delta.content
    void delta
  }
  const response: OpenAI.Responses.Response = await client.responses.create({
    model: 'gpt-synthetic',
    input: 'Hello',
    posthogPrivacyMode: true,
  })
  const floats: number[] = (
    await client.embeddings.create({ model: 'embedding-synthetic', input: 'Hello', posthogDistinctId: 'consumer' })
  ).data[0].embedding
  const base64: string = (
    await client.embeddings.create({ model: 'embedding-synthetic', input: 'Hello', encoding_format: 'base64' })
  ).data[0].embedding
  const azureFloats: number[] = (await azure.embeddings.create({ model: 'embedding-synthetic', input: 'Hello' }))
    .data[0].embedding
  return [completion, response, floats, base64, azureFloats]
}
void calls

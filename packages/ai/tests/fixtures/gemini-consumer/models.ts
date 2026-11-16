import { PostHogGoogleGenAI as Gemini } from '@posthog/ai/gemini'
import type { EmbedContentResponse, GenerateContentResponse } from '@google/genai'
import type { PostHog } from 'posthog-node'

declare const posthog: PostHog
const client = new Gemini({ apiKey: 'consumer-fixture', posthog })

async function models() {
  const response: GenerateContentResponse = await client.models.generateContent({
    model: 'gemini-synthetic',
    contents: 'Hello',
    posthogDistinctId: 'consumer',
  })
  const stream: AsyncGenerator<GenerateContentResponse, void, unknown> = client.models.generateContentStream({
    model: 'gemini-synthetic',
    contents: 'Hello',
    posthogTraceId: 'trace',
  })
  for await (const chunk of stream) {
    void chunk.candidates
  }
  const embedding: EmbedContentResponse = await client.models.embedContent({
    model: 'gemini-embedding-synthetic',
    contents: 'Hello',
    posthogPrivacyMode: true,
  })
  return [response, embedding]
}
void models

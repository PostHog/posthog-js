import type { PostHogGoogleGenAI } from '../src/gemini'

declare const client: PostHogGoogleGenAI

const unary: Promise<{ id: string }> = client.interactions.create({ model: 'gemini-2.5-flash', input: 'Hello' })
const stream: Promise<AsyncIterable<{ event_type: string }>> = client.interactions.create({
  model: 'gemini-2.5-flash',
  input: 'Hello',
  stream: true,
})

void unary
void stream

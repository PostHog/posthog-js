# Vercel AI SDK + PostHog AI Examples

Track Vercel AI SDK calls with PostHog across multiple providers.

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in your API keys in .env
```

## Examples

- **generate-text.ts** - Text generation with tool calling (OpenAI)
- **stream-text.ts** - Streaming text generation (OpenAI)
- **generate-object.ts** - Structured output with Zod schemas (OpenAI)
- **stream-object.ts** - Streaming structured output (OpenAI)
- **anthropic.ts** - Text generation with Anthropic backend
- **google.ts** - Text generation with Google backend

## Run

```bash
source .env
npx tsx generate-text.ts
npx tsx stream-text.ts
npx tsx generate-object.ts
```

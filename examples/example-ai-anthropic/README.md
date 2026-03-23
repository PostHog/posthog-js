# Anthropic + PostHog AI Examples

Track Anthropic API calls with PostHog.

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in your API keys in .env
```

## Examples

- **chat.ts** - Chat with tool calling
- **streaming.ts** - Chat with streaming

## Run

```bash
source .env
npx tsx chat.ts
npx tsx streaming.ts
```

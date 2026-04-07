# Ollama + PostHog AI Examples

Track Ollama API calls with PostHog via the OpenAI-compatible API.

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in your API keys in .env
# Make sure Ollama is running locally: ollama serve
```

## Examples

- **chat.ts** - Chat completions via Ollama

## Run

```bash
source .env
npx tsx chat.ts
```

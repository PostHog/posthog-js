# Google Gemini + PostHog AI Examples

Track Google Gemini API calls with PostHog via OpenTelemetry.

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in your API keys in .env
```

## Examples

- **chat.ts** - Chat with tool calling
- **streaming.ts** - Chat with streaming
- **image-generation.ts** - Image generation

## Run

```bash
source .env
npx tsx chat.ts
npx tsx streaming.ts
npx tsx image-generation.ts
```

# Cloudflare AI Gateway + PostHog AI Examples

Track Cloudflare AI Gateway API calls with PostHog via the OpenAI-compatible unified endpoint.

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in your API keys in .env
```

`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID`, and `OPENAI_API_KEY` are required.

## Examples

- **chat.ts** - Chat completions via Cloudflare AI Gateway (`compat` endpoint)

## Run

```bash
source .env
npx tsx chat.ts
```

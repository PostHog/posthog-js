# Cloudflare AI Gateway + PostHog AI Examples

Track Cloudflare AI Gateway API calls with PostHog via the OpenAI-compatible unified endpoint.

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in your API keys in .env
```

`POSTHOG_API_KEY`, `OPENAI_API_KEY`, `CF_AIG_TOKEN`, `CF_AIG_ACCOUNT_ID`, and `CF_AIG_GATEWAY_ID` are required. `CF_AIG_TOKEN` is your Cloudflare AI Gateway API token, passed via the `cf-aig-authorization` header.

## Examples

- **chat.ts** - Chat completions via Cloudflare AI Gateway

## Run

```bash
source .env
npx tsx chat.ts
```

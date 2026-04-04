# Convex + PostHog AI Examples

Track Convex AI actions with PostHog via OpenTelemetry.

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in your API keys in .env
```

## Examples

- **generate.ts** - Convex-style OTEL integration with Vercel AI SDK and PostHog

## Run

```bash
source .env
npx tsx generate.ts
```

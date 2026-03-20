# Mastra + PostHog AI Examples

Track Mastra agent runs with PostHog using manual instrumentation.

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in your API keys in .env
```

## Examples

- **workflow.ts** - Mastra agent with manual PostHog event capture

## Run

```bash
source .env
npx tsx workflow.ts
```

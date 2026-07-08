# AWS Bedrock + PostHog AI Examples

Track AWS Bedrock LLM calls with PostHog via OpenTelemetry instrumentation.

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in your API keys in .env
# Ensure your AWS credentials are configured
```

## Examples

- **chat.ts** - Bedrock Converse API with OpenTelemetry tracing to PostHog

## Run

```bash
source .env
npx tsx chat.ts
```

# OpenTelemetry + PostHog AI Examples

Send OTEL traces from any instrumented AI SDK to PostHog.

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in your API keys in .env
```

## Examples

- **exporter.ts** - PostHog OTEL trace exporter setup

## Run

```bash
source .env
npx tsx exporter.ts
```

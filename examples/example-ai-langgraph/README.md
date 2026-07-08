# LangGraph + PostHog AI Examples

Track LangGraph agent LLM calls with PostHog.

## Setup

```bash
pnpm install
cp .env.example .env
# Fill in your API keys in .env
```

## Examples

- **agent.ts** - LangGraph ReAct agent with PostHog callback handler

## Run

```bash
source .env
npx tsx agent.ts
```

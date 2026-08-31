# Google ADK + PostHog AI example

Run a Gemini agent with the [Google Agent Development Kit](https://google.github.io/adk-docs/) and capture each model call as a PostHog `$ai_generation` event.

## Setup

From the repository root, build the local SDK tarballs:

```bash
pnpm package --filter=@posthog/ai --filter=posthog-node
```

Then install and configure the example:

```bash
cd examples/example-ai-adk
pnpm --config.pnpmfile=../.pnpmfile.cjs install
cp .env.example .env
# Add your PostHog project token and Google AI API key to .env
```

## Run

```bash
pnpm chat
pnpm chat -- "What are three benefits of agent observability?"
```

The response is printed to the terminal. The model call is captured in PostHog LLM Analytics with `example-ai-adk-user` as its distinct ID and `example-ai-adk` as its `example` property.

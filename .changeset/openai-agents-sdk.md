---
"@posthog/ai": minor
---

Add OpenAI Agents SDK tracing support via `@posthog/ai/openai-agents`. Implements `PostHogTracingProcessor` that captures agent traces, spans, and LLM generations as PostHog LLM analytics events. Supports all span types including generation, response, function/tool, agent, handoff, guardrail, custom, audio, and MCP.

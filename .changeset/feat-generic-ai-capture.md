---
'@posthog/ai': minor
---

Add `captureAiGeneration`, a generic primitive for emitting `$ai_generation` events from LLM calls that don't go through one of the wrapped clients (Cloudflare Workers AI, TanStack AI, custom HTTP, etc.). All built-in wrappers (`withTracing`, `OpenAI`, `Anthropic`, `GoogleGenAI`) now funnel through the same primitive, so external events are indistinguishable from SDK-wrapped ones.

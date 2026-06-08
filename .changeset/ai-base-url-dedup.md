---
'@posthog/ai': minor
---

feat: populate `$ai_base_url` on the Vercel and OpenAI Agents instrumentation paths so gateway-routed `$ai_generation` events can be deduped on ingestion. The Vercel middleware recovers the base URL from the provider's internal `config` (`config.baseURL`, or the `config.url({ path })` closure used by `@ai-sdk/openai` / `openai-compatible`) instead of hardcoding an empty string. The OpenAI Agents processor emits it from `model_config.base_url` when the SDK exposes it (best-effort; the SDK omits it for Responses calls and for chat calls with model settings).

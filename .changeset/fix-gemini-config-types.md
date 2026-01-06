---
"@posthog/ai": patch
---

fix(gemini): expose all GoogleGenAI constructor parameters in wrapper

The `MonitoringGeminiConfig` interface now extends `GoogleGenAIOptions` from `@google/genai`, allowing users to pass all available constructor parameters like `googleAuthOptions` and `httpOptions` without TypeScript errors.

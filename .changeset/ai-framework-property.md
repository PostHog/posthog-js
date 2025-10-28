---
'@posthog/ai': minor
---

feat: add $ai_framework property for framework integrations

Adds a simple `$ai_framework` property to AI events when using framework layers (LangChain, Vercel AI SDK). Direct provider calls (OpenAI, Anthropic, Gemini) do not include this property, eliminating redundant data where framework would duplicate the provider name.

**Example with framework:**
```json
{
  "$ai_framework": "langchain",
  "$ai_provider": "openai",
  "$ai_model": "gpt-4"
}
```

**Example without framework:**
```json
{
  "$ai_provider": "openai",
  "$ai_model": "gpt-4"
}
```

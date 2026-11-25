---
'@posthog/ai': patch
---

`$ai_tools` masks the credentials in Gemini tool definitions with `[REDACTED]`, with or without privacy mode: every `apiKey`, `apiAuth`, `authConfig`, and `headers` inside a built-in tool's config, such as `retrieval`, `googleMaps`, `exaAiSearch`, `parallelAiSearch`, and `mcpServers`. Function declarations are not masked. The tools you pass in are not modified.

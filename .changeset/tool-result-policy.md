---
'@posthog/ai': patch
---

Share tool-result JSON-safe normalization and binary redaction across AI adapters without introducing an unagreed size policy. Cover Anthropic MCP/server-tool results and OpenAI Responses code-interpreter outputs and file-search results, preserving provider requests, result metadata, and full-capture/privacy behavior.

Gemini keeps its existing 5,000 UTF-8-byte whole-result ceiling plus truncation marker: small results retain their structure, while oversized results become text previews that can omit later fields. Claude Agent keeps its existing 5,000-byte per-string history limit and separate 200,000-byte original-span limit. OpenAI Chat/Responses (including Azure) and direct Anthropic do not gain a new 5 KB cap on tool-output strings or text blocks. These provider-specific limits do not guarantee an event fits transport limits; agreement on a uniform capture budget remains separate.

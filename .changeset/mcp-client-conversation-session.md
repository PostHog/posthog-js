---
'@posthog/mcp': minor
---

Group tool calls into sessions by the client's own conversation id in `_meta`: ChatGPT's `openai/session`, Codex's `sessionId`, and VS Code's `vscode.conversationId`, each read only from the client its `User-Agent` or client name identifies. The client's id wins over a conversation handle and a transport session. ChatGPT gets no `conversation_id` argument and no handle, so its tool schemas and results stay unchanged. Every event now records which source grouped it as `$mcp_session_source`. `PostHogMCP.prepareToolList` and `prepareToolCall` take the request's `headers` (and `clientInfo`), and `captureToolCall` takes `requestMeta`.

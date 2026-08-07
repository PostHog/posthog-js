---
'@posthog/mcp': patch
---

Keep the conversation-id prompt-back out of `$mcp_error_message`.

With `enableConversationId` on, a `[SERVER]: Reuse conversation_id=…` block is appended to a tool result so the agent echoes the handle back on later calls. The captured error was read from that already-appended result, so a failed call reported `"intentional failure [SERVER]: Reuse conversation_id=019f…"` — a fresh uuid inside the error message on every call, which splits one recurring failure into a new error group each time it happens.

The error is now read from the result as the tool produced it, before the handle is written in. It bites hardest on MCP SDK v2, where a thrown error is flattened into an `isError` result before the SDK hands it to us, so that result is the only description of the failure available. The agent still receives the prompt-back on failed calls — that is when it matters most, since otherwise the retry starts a new conversation and the failure and its fix land in different sessions.

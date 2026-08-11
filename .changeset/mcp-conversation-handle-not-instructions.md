---
'@posthog/mcp': minor
---

fix(mcp): `enableConversationId` no longer puts instructions in tool results

The conversation handle is now delivered as plain data — a factual line in `content` and a
`_conversation.conversation_id` field in `structuredContent`. The previous `[SERVER]: Reuse
conversation_id=… Required for the server to …` text block was flagged as a prompt-injection attempt
and refused.

The rules move to the `conversation_id` input-schema description, where clients fetch them at
`tools/list` as part of the tool contract, and stay strict there: agents are still told never to
invent a handle and not to issue parallel tool calls before they have one.

Also in this release: the `structuredContent` key is renamed `_mcp_instructions` → `_conversation`
and no longer carries an `instructions` string, and `enableConversationId` accepts an object form
(`{ description?, resultText? }`) so the `content` line can be reworded or turned off entirely.

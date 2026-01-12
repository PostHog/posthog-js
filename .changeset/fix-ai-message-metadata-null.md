---
"@posthog/ai": patch
---

fix(ai): Convert null messageMetadata to undefined in Vercel AI SDK streaming

Adds defensive handling for `messageMetadata: null` in stream chunks when using withTracing with the Vercel AI SDK.

**Problem:**
The AI SDK's `mergeObjects` function guards against `undefined` but not `null`. When certain model providers (particularly with file attachments) send stream chunks with `messageMetadata: null`, the AI SDK throws "Cannot convert undefined or null to object" when attempting to spread the null value.

**Solution:**
In the doStream TransformStream, check for `messageMetadata === null` and convert it to `undefined` before passing the chunk through. This allows the AI SDK's existing guards to work correctly.

**Context:**
- Reported via support ticket with ToolLoopAgent and file attachments
- Root cause is in AI SDK's mergeObjects function which only handles undefined
- This is a defensive fix - the exact reproduction conditions are environment-specific

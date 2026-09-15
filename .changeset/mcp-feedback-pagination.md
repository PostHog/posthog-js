---
'@posthog/mcp': patch
---

Inject the send_feedback tool only on the first tools/list page (the request with no cursor), so a paginated catalogue's concatenated listing carries it once instead of once per page. A real first-page tool with the same name still wins: the SDK warns, skips injection, and forwards its calls. A real tool that only appears on a later page is not detected — the SDK logs a warning when a client fetches that page; rename the SDK's tool with `collectFeedback: { toolName }` if your catalogue uses the name.

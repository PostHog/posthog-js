---
'@posthog/mcp': patch
---

Inject the get_more_tools tool only on the first tools/list page, so a paginated catalogue's concatenated listing carries it once instead of once per page. A real first-page tool with the same name still wins (warning logged); a real tool on a later page is shadowed, with a warning when a client fetches that page — rename the SDK's tool with the `missingCapabilityToolName` option if your catalogue uses the name.

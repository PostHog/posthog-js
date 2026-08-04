---
'@posthog/mcp': minor
---

Capture the calling client's User-Agent and vendor client header on every auto-captured MCP event, as `$mcp_client_user_agent` and `$mcp_vendor_client`.

MCP's own `clientInfo` can't tell a vendor's products apart — Anthropic reports `clientInfo.name = "claude-code"` from the CLI, the Agent SDK, the VS Code extension and the desktop app alike, so `$mcp_client_name` collapses them into one bucket. The surface is only visible in the User-Agent parenthetical (`claude-code/2.1.0 (cli)` vs `(sdk-ts)` vs `(claude-vscode)`), so capturing it is what lets you see which of your integrations traffic actually comes from.

Automatic on HTTP transports (`instrument()` reads the headers per request); stdio and in-memory servers, which have no headers, are unchanged. On the `PostHogMCP` custom-dispatcher path, pass `clientUserAgent` / `vendorClient` on your capture calls. Both values are recorded raw — PostHog resolves them to friendly product labels at query time, so labels keep improving without an SDK upgrade.

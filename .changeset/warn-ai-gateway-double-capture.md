---
"@posthog/ai": minor
---

feat: warn when the AI wrapper's `base_url` points at the PostHog AI Gateway. The gateway emits its own `$ai_generation`, so routing the wrapper through it double-captures (and, for billable products, double-bills) every call. The warning logs on every routed call; the wrapper's event is left untouched, since it carries data the gateway never sees (groups, custom properties, trace hierarchy).

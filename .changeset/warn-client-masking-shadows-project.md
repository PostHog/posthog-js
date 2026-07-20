---
'posthog-js': patch
---

Warn when session recording masking options in `posthog.init` shadow the project-level "Privacy and masking" setting. Client-side masking still intentionally takes precedence, but previously the override was silent — a developer could set masking in the dashboard and see it quietly ignored because their SDK config diverged. The recorder now logs a console warning (in debug mode) naming the diverging fields so the precedence is self-explaining.

---
'posthog-js': patch
---

Fix session replay shipping one billable recording per session rotation for tabs the user never interacts with. A session born from an idle rotation now holds its buffer until the first user interaction, then ships a recording playable from the session's start; without interaction nothing is sent — a further rotation, stop, opt-out, or page unload discards the held data instead of shipping it. An event trigger match (for example record-on-exception) also releases the hold, since it is explicit intent to record the session.

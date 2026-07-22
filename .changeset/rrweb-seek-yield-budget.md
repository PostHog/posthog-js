---
'@posthog/rrweb': minor
'@posthog/rrweb-replay': patch
'posthog-js': patch
---

The replayer can now yield to the event loop while fast-forwarding to a seek target, via the new opt-in `seekYieldBudgetMs` player config. Seeking in a long, event-dense recording rebuilds the target frame by re-applying every event since the last full snapshot in one uninterrupted main-thread pass, which can block the page for many seconds and trigger the browser's "Page Unresponsive" dialog; when a yield budget is set, the rebuild runs in time-budgeted chunks instead, and a newer seek cancels any rebuild still in flight so rapid scrubbing only pays for the last seek. A superseded rebuild also resets the machine's `lastPlayedEvent` so the next seek performs a full rebuild rather than trusting a partially-applied history. The default (0) keeps the previous fully-synchronous behavior.

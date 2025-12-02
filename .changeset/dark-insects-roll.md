---
'posthog-js': patch
---

A click while holding a modifier key (CTRL, ALT, CMD, Windows) shouldn't ever count as a dead click - so that we don't pick up e.g. open in a new tab as a dead click

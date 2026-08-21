---
'posthog-js': patch
---

fix(replay): replay events captured while the recorder script was lazy loading through event trigger matching, so a trigger on e.g. the initial $pageview can match on the first page of a pageload

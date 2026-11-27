---
'posthog-js': patch
---

Stop `$dead_click` and `$dead_swipe` from reporting a click or swipe made before a consent change, such as an opt-out followed by an opt-in, a switch into or out of cookieless mode, or a consent change in another tab.

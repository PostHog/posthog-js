---
'posthog-js': patch
---

Stop recording `autoplay` attribute mutations on `<video>` and `<audio>` during session replay. The check compared a lowercase tag name against `Element.tagName`, which is uppercase for HTML elements, so a looping background video emitted a mutation for every `autoplay` toggle.

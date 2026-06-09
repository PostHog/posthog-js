---
'posthog-js': patch
---

Surveys: event-triggered surveys now survive a page reload. Previously a survey activated by an event was consumed the moment its `survey shown` event fired, so reloading before the user dismissed or answered it made the survey vanish until the trigger event fired again. Non-repeatable surveys now stay activated until the user actually dismisses or responds, so they re-display on reload. Repeatable surveys (`schedule: 'always'` or "Show every time the event is captured") keep their existing behaviour of showing once per captured trigger.

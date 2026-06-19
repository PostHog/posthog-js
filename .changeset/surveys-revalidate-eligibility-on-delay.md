---
'posthog-js': patch
---

Surveys: re-check eligibility when a popover's display delay elapses, instead of only re-checking the URL.

A survey with a display delay could be queued while a visitor was still anonymous (the targeting flag passed for the anonymous profile), and then displayed after the delay even though `identify()` had reloaded feature flags and the survey's internal targeting flag was now false for the identified profile (e.g. a "show once per user" survey the person had already dismissed). The delayed display now re-runs the full display predicate (eligibility, URL/device/selector conditions, event/action trigger, and feature flags) before rendering, so a survey that became ineligible during the delay is no longer shown. Pending delayed surveys are also cancelled promptly when a later evaluation cycle finds them ineligible.

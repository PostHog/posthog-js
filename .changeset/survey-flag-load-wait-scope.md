---
'posthog-js': patch
'@posthog/core': patch
---

fix(surveys): only wait for feature flags on surveys that repeat

Surveys stopped being shown while feature flags were still loading, even when a cached
enabled value for their internal targeting flag was already available. Popover and widget
surveys recovered on the next evaluation, but a survey your own code renders (type `api`)
is evaluated once, so it was dropped for that page load and never reappeared.

That wait is only needed for surveys that repeat, where stored per-survey state is keyed by
iteration and cannot be relied on to record that someone already answered. Other surveys
keep one stable key that already prevents a repeat display, so they are now evaluated
against the cached flag right away.

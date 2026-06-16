---
'posthog-js': patch
---

Surveys: event-triggered surveys are now scoped to the session the event fired in, and only persist across a page reload once they have actually been shown.

Previously an event armed a survey by writing it to localStorage, where it stayed until shown. Because the activation survived reloads and the URL condition was only checked at display time, a survey armed by an exit-intent event (which fires as the user is leaving or reloading) could surface on a later page load with no event behind it. Activations now live in memory until the survey is shown, so an armed-but-unshown survey no longer reappears after a reload.

Once a survey is shown it is promoted to persistence, so a non-repeatable survey survives a reload and re-displays until the user dismisses or answers it (instead of vanishing if they reload before interacting). Repeatable surveys (`schedule: 'always'` or "Show every time the event is captured") are still consumed when shown, so each captured trigger shows them once. Product tours follow the same model. Cross-page deferral (arm on one full page load, display on a later one) is no longer supported via event triggers; use audience targeting for that.

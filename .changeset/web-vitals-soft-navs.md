---
'posthog-js': minor
'@posthog/types': minor
---

feat: add opt-in `capture_performance.web_vitals_soft_navs` to fix inflated web vitals on single-page apps

Client-side route changes in SPAs previously left web vitals (LCP especially) accumulating against the original hard-navigation timestamp, inflating the top tail of Core Web Vitals. Setting `capture_performance: { web_vitals_soft_navs: true }` now scopes metrics to the browser's Soft Navigation entries so each route change starts a fresh measurement window. It's opt-in because it relies on Chrome's experimental Soft Navigation Detection API and loads a slightly larger soft-navs build of the web-vitals library; when disabled (the default) behavior and bundle are unchanged.

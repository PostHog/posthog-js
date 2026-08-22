---
"posthog-js": minor
"@posthog/types": minor
---

Web vitals now capture attribution by default for INP and LCP, so a slow interaction or paint arrives with the target element and phase breakdown that make it diagnosable. CLS stays without attribution by default, because its attribution holds detached DOM nodes and can leak memory in single-page apps. Set `capture_performance.web_vitals_attribution` to `false` to opt out, `true` for every metric, or an array to name the metrics. The captured metric also drops the empty `entries` array and bounds attribution to a small set of useful fields.

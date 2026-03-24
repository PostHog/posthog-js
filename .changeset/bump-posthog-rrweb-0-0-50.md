---
'posthog-js': patch
---

Bump @posthog/rrweb packages to 0.0.50, which includes:
- PostHog/posthog-rrweb#145: fix: handle cross-origin iframe errors during stop handler cleanup
- PostHog/posthog-rrweb#148: fix: mask textarea innerText mutations
- PostHog/posthog-rrweb#150: fix: guard WebGLRenderingContext access for iOS compatibility
- PostHog/posthog-rrweb#151: refactor: extract slimDOMDefaults into shared function
- PostHog/posthog-rrweb#152: fix: improve nested CSS rule handling
- PostHog/posthog-rrweb#153: fix: allow clearing adopted stylesheets with empty strings
- PostHog/posthog-rrweb#154: fix: prevent object reference mutation breaking remote CSS replay

---
"posthog-js": patch
---

Don't let save_referrer overwrite a $referrer / $referring_domain that was explicitly set via posthog.register(), so registered attribution values survive pageviews in SPA and iframe contexts

---
'posthog-js': minor
---

Read Meta's `_fbc` and `_fbp` cookies for the Conversions API. When the Meta pixel is on the page, its `_fbc` cookie holds the true ad click time, so that value now wins over the time PostHog stamps on the pageview that follows the click, and a click that landed before the SDK loaded is no longer lost. The `_fbp` browser ID is captured as the `$fbp` person property, which makes it available to a conversion sent later from a backend.

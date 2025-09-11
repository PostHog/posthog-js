---
'posthog-js': patch
---

Fixed a bug that prevented surveys from loading in cookieless mode using the on_reject option. Surveys now correctly initialize when consent is given.

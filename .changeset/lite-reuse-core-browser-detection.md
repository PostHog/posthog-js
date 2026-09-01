---
'posthog-js-lite': minor
---

Use the shared `@posthog/core` browser detection instead of a separate copy. `$browser` and `$browser_version` now match posthog-js.

This reattributes some events. Browsers the old copy missed (Vivaldi, Yandex, Whale, DuckDuckGo, Brave on iOS, Pale Moon, Waterfox, Oculus Browser) now report their own name instead of `Chrome` or `Safari`. User agents that only contain `Gecko` now report `Firefox` instead of `Mozilla`. Opera versions older than 15 are no longer detected.

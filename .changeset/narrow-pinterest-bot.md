---
'@posthog/core': patch
'@posthog/browser-common': patch
'posthog-js': patch
'posthog-node': patch
---

Narrow the `pinterest` entry in the bot-detection blocklist to `pinterestbot`, so real users on Pinterest's in-app browser (whose UA also contains the substring `pinterest`) are no longer misclassified as bots and silently excluded from analytics. The crawler's other UA variant remains covered by the existing generic `bot.htm` entry, so no bot-detection coverage is lost.

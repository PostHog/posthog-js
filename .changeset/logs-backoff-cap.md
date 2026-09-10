---
'posthog-js': patch
'posthog-react-native': patch
'@posthog/core': patch
---

Cap the retry delay for log exports at 30 seconds, the ceiling the logs contract states. It previously doubled to 64 times the flush interval — 192s on web, 640s on React Native — so a log export now resumes within 30 seconds of a failing endpoint recovering, at the cost of more retry requests while that endpoint is down.

---
'@posthog/core': patch
---

Fix `identify()` leaving a user anonymous when the supplied ID already matches the persisted distinct ID (for example after a non-identified bootstrap seeded the same ID). The user is now marked identified and a person-processed `$set` event is captured. Ports the same fix from posthog-js (browser) to the shared core used by React Native and Node.

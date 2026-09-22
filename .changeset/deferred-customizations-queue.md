---
'posthog-js': patch
---

fix(customizations): queue customization calls made before a deferred bundle loads

`customizations.full.js` publishes `window.posthogCustomizations` when the script runs, so a page that loads it with `defer` has no global while the `loaded` callback runs. The customization never ran and a flag that targets on `$current_url` or on a campaign parameter evaluated without those person properties. The snippet bootstrap now installs a stub that queues the calls a customization makes on the instance it receives, and the bundle replays the queue when it lands.

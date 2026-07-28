---
'posthog-js': patch
'@posthog/types': patch
---

fix(replay): stop `maskCapturedNetworkRequestFn` from dropping initial navigation/performance metadata

Initial navigation and performance-timing entries are captured before fetch/XHR wrapping, so they arrive with `method === undefined`. A user mask function keyed on the method (e.g. `data => data.method === 'GET' ? data : undefined`) would silently drop these metadata entries and produce a black-screen recording. These `isInitial` entries are now exempted from the user mask function (enforced cleaning still runs), and the config docs call out that entries can arrive without a method.

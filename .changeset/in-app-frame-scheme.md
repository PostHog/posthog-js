---
'@posthog/core': patch
'posthog-js': patch
'posthog-react-native': patch
---

Error tracking no longer counts an injected script as your own code. A stack frame is `in_app` only when its filename names a script your app was served — `http(s)`, `file`, `blob`, `app`, `capacitor`, `ionic`, a bundler scheme, or a bare path. A frame served over any other scheme, such as an in-app browser bridge on `iabjs://` or an extension content script on `chrome-extension://`, is kept for context but no longer groups the issue under your code.

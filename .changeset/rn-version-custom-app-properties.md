---
'posthog-react-native': patch
---

Keep `$react_native_version` on events when `customAppProperties` is an object. Set `$react_native_version: undefined` in the object to leave it out.

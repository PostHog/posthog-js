---
'posthog-react-native': patch
---

Forward `requestHeaders` to the native plugin so custom headers (e.g. `Authorization`) are also applied to session replay and native error/crash uploads, which are sent directly by the native SDK. Requires native SDK support for the headers to take effect.

---
'posthog-react-native': minor
---

React Native surveys: the modal now renders with a dark semi-transparent backdrop so it stands out from underlying UI. Embedders can opt in to closing the survey by tapping that backdrop via the new `appearance.closeOnBackdropPress` flag (default `false`; the X button still closes regardless). Tapping outside the modal dismisses the keyboard either way.

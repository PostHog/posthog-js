---
'posthog-react-native': patch
---

React Native surveys: closing a survey from Q2+ or the Thank You screen no longer flashes the first question during the fade-out. Opening another survey shortly after closing one no longer flashes the previous survey's content for the first frame on iOS — survey content unmounts one frame before the Modal dismisses so the UIKit snapshot the OS recycles is blank.

---
'posthog-react-native': patch
---

fix: repeating surveys now show again when a new iteration starts. The local seen state is keyed by survey iteration (matching the web SDK), so a survey scheduled to repeat no longer stays hidden on a device after the first response.

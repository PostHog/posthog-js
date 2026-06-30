---
"posthog-js": patch
"posthog-react-native": patch
---

Improve survey display reliability:

- **posthog-js**: refresh the cached `$surveys` definitions after a short TTL (stale-while-revalidate) so server-side changes such as switching a survey from popover to API propagate to long-lived tabs without a page reload.
- **posthog-js**: add `posthog.surveys.markSurveyAsSeen(surveyId, { iteration })` so custom integrators that render surveys through their own backend can honour the "already seen" and wait-period checks.
- **posthog-react-native**: guarantee the survey `Modal` notifies its parent on close even when iOS `Modal.onDismiss` fails to fire, so the transparent full-screen modal can no longer stay mounted intercepting touches and freezing the app.

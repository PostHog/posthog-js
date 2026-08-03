---
'posthog-js': patch
---

Session replay no longer ships recordings for sessions that have seen no user interaction. A recorder in a tab nobody has touched (the 'unknown' idle state) now holds its buffer, bounded to the newest playable snapshot prefix, and ships it only on the first user interaction, on page unload, or not at all if the session rotates away untouched. This stops activity-timeout rotations in parked tabs from producing unbounded chains of zero-interaction billable recordings, while keeping rotated sessions playable from before the user's first interaction. Confirmed-idle tabs also now keep running the session check, so an idle session rotates at the 24-hour session cap instead of accreting a multi-day recording.

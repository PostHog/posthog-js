---
'@posthog/core': patch
'posthog-react-native': patch
---

Changing a group's key with `group()` now drops the group properties cached for flags under the previous key, so they are no longer sent for the new group.

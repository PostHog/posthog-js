---
'posthog-js': patch
---

fix(persistence): skip the storage write when the serialized props are unchanged. Callers spam `save()` after every property change, and many of those changes leave the serialized payload identical (e.g. resetting a value to its current value). Writing identical bytes to localStorage still fires a cross-tab `storage` event in every same-origin tab, where Chrome allocates the payload buffer in mojo IPC even though no listener reacts. Now `save()` compares the serialized payload against the last successful write and bails out when nothing changed.

---
'@posthog/mcp': major
---

Release 1.0.0. The API and the `$mcp_*` events are now stable: a minor or patch release no longer renames or removes an event or property, changes its type, or changes which requests send an event, so your saved insights keep working across upgrades. New events and properties can still arrive in minor releases. Upgrading from 0.x needs no code change.

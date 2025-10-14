---
'posthog-js': minor
---

Added cross-browser session bootstrapping functionality:

- Added `enable_bootstrap_from_url` config to bootstrap `distinct_id` and `session_id` from URL parameters
- Added support for bootstrapping session properties (attribution data like UTM parameters) via `__ph_session_entry_*` URL parameters
- Added `sessionProps` field to `BootstrapConfig` for explicit session property bootstrapping
- Added `get_session_properties()` API method to retrieve current session properties
- Session properties are now preserved when users navigate across different browsers, domains, or devices

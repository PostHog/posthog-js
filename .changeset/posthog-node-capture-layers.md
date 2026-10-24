---
'posthog-node': major
---

Values set on the event, in context or with `register()` / the new `registerOptions()` now win over the values the SDK adds (`$is_server`, `$geoip_disable`, feature flag properties, trace ids), and `before_send` sees and can change all of them; context and registered properties and options, including the new context `options`, also reach identify, alias and group identify events.
An empty or whitespace distinct id counts as missing, and `$groupidentify` without a distinct id uses the context id, then `$<type>_<key>`.

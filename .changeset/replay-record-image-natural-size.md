---
'posthog-js': patch
'@posthog/rrweb': patch
'@posthog/rrweb-snapshot': patch
'@posthog/rrweb-types': patch
---

Session recordings now carry each image's natural size, so a replay that cannot load a picture can still reserve the box the page laid out from it.

The recorder adds generated `rr_naturalWidth`/`rr_naturalHeight` attributes to `<img>` nodes, in the snapshot and as attribute mutations when an image loads or fails to load. To carry them, the value type of `attributeMutation.attributes` in `@posthog/rrweb-types` widens from `string | styleOMValue | null` to also include `number`; code that narrows those values exhaustively needs a `number` branch.

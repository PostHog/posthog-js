---
"@posthog/rrweb": patch
---

Session replay: harden observation of open shadow roots that were attached before recording started. Registration for pre-existing shadow hosts previously depended entirely on the full-snapshot serialization pass; recording now also enumerates already-attached open shadow roots when the snapshot is taken and registers a MutationObserver on each (recursing into nested shadow trees), so the coverage is order-independent and no longer relies on every host being reached by the serialization walk. This targets replays that freeze on the initial snapshot for widgets that `attachShadow` at page load (the common Vue / web-component case), where incremental shadow-DOM mutations were not being captured. Also fixes a latent bug where the mutation-time shadow-host check looked at the top inserted node rather than the node being serialized, so a shadow host nested inside an added subtree could be skipped.

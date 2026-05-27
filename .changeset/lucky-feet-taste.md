---
'@posthog/rrweb-snapshot': patch
'@posthog/rrweb': patch
---

fix(replay): keep `ph-no-capture` placeholders in normal flow during replay. Blocked elements were rebuilt with `position: absolute` + recorded `left/top` regardless of how they were originally positioned, pulling in-flow elements (flex/grid children, inline spans) out of flow and collapsing sibling layout. Snapshot now captures the element's computed `position`, `transform`, and `display`; rebuild only forces absolute positioning when the original was non-static or contributed a transform, and promotes inline placeholders to `inline-block` so the redacted slot is preserved. Old recordings without the new attributes keep the legacy absolute behavior.

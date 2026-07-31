---
'@posthog/rrweb-snapshot': minor
'@posthog/rrweb': minor
'posthog-js': minor
'@posthog/types': minor
'@posthog/browser-common': minor
---

Add attribute-level masking to session replay: `maskAttributeFn` for per-attribute control, and a coarse `maskAllElementAttributes` switch (mirroring autocapture's `mask_all_element_attributes`). Rendering-critical attributes (`id`, `class`, `style`, `src`, `href`, etc.) are left untouched by the coarse switch so recordings still render.

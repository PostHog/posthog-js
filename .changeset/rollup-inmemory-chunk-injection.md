---
'@posthog/rollup-plugin': patch
'@posthog/plugin-utils': patch
---

Inject chunk ids (a fresh random id per build) into chunks in-memory during `renderChunk` instead of letting posthog-cli rewrite the emitted files on disk in `writeBundle`. The written bundle already contains the chunk-id snippet, so Subresource Integrity plugins (e.g. vite-plugin-sri3, which hashes chunks in `generateBundle`) now compute hashes over the final content and the browser no longer blocks the scripts. `writeBundle` runs the non-mutating `sourcemap upload` instead of `sourcemap process`, and with `deleteAfterUpload` the plugin deletes the `.map` files itself rather than passing `--delete-after` (which also rewrites the `.js` files).

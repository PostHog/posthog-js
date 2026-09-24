---
'@posthog/rollup-plugin': patch
---

Keep the release snippet byte-exact under Vite 8 minification, so posthog-cli recognizes it and stops re-uploading unchanged chunks on every release.

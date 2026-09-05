---
'@posthog/esbuild-plugin': minor
---

Add an esbuild plugin that injects error-tracking chunk IDs into in-memory JavaScript and composes the source maps before Angular or another build system computes asset hashes. This lets Angular generate a valid `ngsw.json`; source maps are uploaded afterward with the non-mutating `posthog-cli sourcemap upload` command.

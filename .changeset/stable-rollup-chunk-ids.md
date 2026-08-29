---
'@posthog/rollup-plugin': patch
---

The default (symbol-set) release mode now derives chunk ids from chunk content instead of a random id per build, so identical builds keep the same chunk id and the same content-hashed `[hash]` file names instead of renaming every chunk on every build.

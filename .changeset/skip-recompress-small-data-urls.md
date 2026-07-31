---
'@posthog/rrweb-snapshot': patch
'posthog-js': patch
---

Session replay no longer freezes the page re-encoding base64 images that are already small. When canvas recording is enabled, every `<img>` with a `data:` URL was synchronously redrawn and re-encoded through `canvas.toDataURL` during full snapshots and attribute mutations. The encode cost scales with pixel dimensions, not payload size, so a page of base64 lazy-load placeholders (measured: 18 images of 4096x3072 at ~33KB each) blocked the main thread for 7+ seconds to produce outputs that were larger than the inputs. Recompression now skips data URLs under 100KB (where it cannot save meaningful payload), keeps the original when the re-encoded output is not smaller, and memoizes by input so repeated snapshots and src-swapping mutations never pay for the same image twice. Genuinely large base64 images are still recompressed as before.

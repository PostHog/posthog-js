---
'@posthog/core': patch
'posthog-node': patch
---

The Node SDK now sends the raw gzip bytes as the request body instead of wrapping them in a `Blob`. On Node 24.16 and later, reading a `Blob` request body leaks a native `BlobReader` that is never released, so a service calling `capture()` and `flush()` once per request grew by roughly 2.3 KB of heap per event and never gave it back. This completes the work in #4423: switching to `node:zlib` removed the compression-time Blob reads, but the body itself was still a Blob and still got read once per request. Compression behaviour, headers and the wire format are unchanged, and the edge build keeps using `CompressionStream`.

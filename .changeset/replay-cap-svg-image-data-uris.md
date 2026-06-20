---
'posthog-js': patch
---

Session replay: apply the existing base64 image size cap (`maxBase64ImageLength`) to SVG `<image>` elements with `data:` URIs on both `href` and `xlink:href`. Previously the cap only covered `<img>` elements, so large inline data URIs inside SVGs were recorded in full - this also covers them in mutations, replacing oversized ones with the striped placeholder.

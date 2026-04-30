---
'@posthog/rrweb': patch
'@posthog/rrweb-snapshot': patch
---

fix(record): release iframe documents and observers on iframe removal — same-origin iframes mounted and unmounted while session recording is active no longer leak their `Document`, every node serialized into the mirror, or one `MutationObserver` per mount. Closes five retainer chains: load-listener disposers, named pagehide handlers, the `recordCrossOriginIframes` cleanup gate (now applied to same-origin too), captured `Document` / `Window` sets that survive `iframe.src` swap-to-`about:blank` before removal, and the global `mutationBuffers[]` / `handlers[]` arrays which previously accumulated forever. Validated end-to-end: a host page that mounts/unmounts 5 blob-URL iframes every 2s for 110s went from +118 MB / +390 leaked `HTMLDocument`s to ~0 MB / 0.

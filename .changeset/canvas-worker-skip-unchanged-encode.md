---
'@posthog/rrweb': patch
---

Canvas capture now fingerprints raw pixels before encoding, so unchanged frames skip the expensive image encode entirely. Previously every captured frame was encoded (webp/png) and base64'd just to compute a fingerprint, with unchanged frames dropped only after paying the full encode cost — for a static canvas at the default fps this burned CPU continuously for the lifetime of the page. Blank first frames are now detected from pixel data and never encoded either (previously they cost two encodes: one for the frame and one for a transparent reference blob). What gets transmitted is unchanged: first frames, changed frames, and content-to-blank transitions are still sent; unchanged and blank-first frames are still acknowledged without payload.

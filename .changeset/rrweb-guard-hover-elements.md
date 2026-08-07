---
'@posthog/rrweb': patch
---

Guard the replayer's hover handling against non-element and detached hover targets, which previously threw an unhandled `TypeError` (`querySelectorAll` on a node without that method) and stopped session recording playback mid-stream.

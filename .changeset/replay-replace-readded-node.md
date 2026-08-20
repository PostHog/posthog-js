---
'posthog-js': patch
---

Session replay no longer renders a duplicate copy of an element that existed only once on the real page. When an add mutation arrived for a node id the mirror already held and the node attributes had changed, the replayer built a replacement element and re-pointed the mirror id at it, but left the old element in the document with no mirror id. No later remove could reach that element, so it stayed on screen as a duplicate until the next full snapshot. The replayer now detaches the old element before it builds the replacement, so a re-added id replaces the node instead of duplicating it. This holds on both replay paths, with `useVirtualDom` on and off.

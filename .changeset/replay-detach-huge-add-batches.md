---
'posthog-js': patch
---

The replayer no longer freezes the tab on a mutation that adds tens of thousands of nodes at once. It now applies a batch of 1,000 or more adds against a detached subtree, so the document updates style and layout once instead of per insert. A recorded batch of 25,746 style elements went from 92 seconds of blocked main thread to 1.5 seconds.

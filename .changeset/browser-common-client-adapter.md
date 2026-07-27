---
'@posthog/browser-common': patch
---

Reduce extension runtime and contract overhead by replacing the `CoreExtension` and capability-token registry with one host-provided `Client`. Extensions now access analytics, identity, session, events, remote config, transport, persistence, and logging directly from that client.

Cross-extension `getExtension`/`provides` lookup and session lifecycle observation are no longer part of the shared contract. Extension cleanup is synchronous and best-effort: resources are released in reverse registration order, and Promise-returning legacy cleanup is not awaited but rejected Promises are contained.

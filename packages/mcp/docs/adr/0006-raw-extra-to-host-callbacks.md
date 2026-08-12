# ADR-0006: Host callbacks receive the SDK's `extra` unchanged

- Status: Accepted
- Date: 2026-08-07

## Context

`identify`, `intentFallback`, `eventProperties` and `beforeSend` all receive the per-request `extra` object the MCP SDK hands our handler. Hosts routinely read HTTP headers off it — an auth token in `identify` is the common case.

The two SDK majors put the request in different places **and** different shapes: v1 attaches a plain object at `extra.requestInfo.headers`; v2 attaches the WHATWG `Request` at `extra.http.req`, whose `headers` is a `Headers` that only answers to `.get()`. Every v1-shaped read therefore returns `undefined` on v2, and an `identify()` written that way returns `null` and sends every event anonymous. Confirmed on the reporter's stack in PostHog/posthog-js#4449.

Opening the compatibility gate (ADR-0005) is what first sends v2-shaped `extra` to these callbacks, so the two ship together: the gate alone converts "no events" into "events with no user", which is the same looks-healthy-but-wrong failure.

Normalising `extra` toward v1 before handing it over was considered and rejected. Synthesising a `requestInfo` fabricates a shape the SDK deliberately removed; a host reading any field we did not fake gets a convincing partial lie, which is worse than a shape that is honestly absent. It would also confuse v2-native hosts whose code is already correct.

## Decision

Host callbacks receive whatever the SDK handed us, unchanged. Instead, `getRequestHeaders(extra)` is **exported**, so a host's migration is one line rather than a hand-written two-branch read:

```ts
import { getRequestHeaders } from '@posthog/mcp'
identify: async (request, extra) => getRequestHeaders(extra)?.['authorization']
```

- It returns a plain, lowercase-keyed bag — not a `Headers`-like `.get()` interface — so existing `headers['authorization']` code changes the *path* and keeps the *access style*.
- It normalises **by shape, not by source**: both locations are checked for both shapes, because a framework may hand us a plain object where the SDK hands `Headers`.
- `Headers` is duck-typed on `.entries`, never `instanceof` — workerd and other edge runtimes are a different realm.
- Every internal header read goes through it too, including `readTransportIdentity`, which had shipped reading the v1 location only.

`headers.ts` keeps answering a different question — reading one value out of a bag — and the two compose.

## Consequences

- A host on v2 must change its callbacks. That is a documented migration in the README, not a silent behaviour change: we cannot fix their code, only make the fix one line.
- Two independent precedents agree: #4449 asked for documentation rather than normalisation, and AgentCat's v2 rewrite also passes raw `extra` to customer hooks and projects it only for the event payload.
- The exported helper is now public API, so its return shape is frozen by the usual rules.

## References

- PostHog/posthog-js#4449, #4462 (this change), ADR-0005


# ADR-0013: Model capture and conversation correlation are on by default

- Status: Accepted. Reverses the opt-in default recorded in ADR-0004's Consequences.
- Date: 2026-09-15

## Context

The product's promise is one line of install producing intent, sessions, and model per tool call. Two of those were opt-in. Under the 2026-07-28 revision there is no transport session, so a deployment that never turned on `enableConversationId` fragments to one session per call — ADR-0009 kept the legacy header mint precisely because that was the out-of-the-box story. `captureModel` shipped opt-in a week before this record; opt-in analytics fields are rarely turned on, so the data they exist to collect never arrives. The roadmap (PostHog/posthog#64016) names `$mcp_conversation_id` as the direction for stateless session tracking.

A default is only worth flipping if it works on the topology the revision makes the norm: a fresh server instance per request, which never served a `tools/list` and so cannot say who owns an argument. ADR-0011 already decided how unknown ownership is handled, but only `context` had received that treatment; `llm_model` and `conversation_id` still required positive ownership for both reading and stripping, so on a cold instance the model stayed empty and the session handle was ignored (the "C2" rows parked in the integration harness).

The first draft of this change resolved ownership by replaying the host's raw `tools/list` handler inside `tools/call`, paginated and time-boxed. Three independent reviewers flagged the cost before anyone re-read ADR-0011, which rejects that design for the same reason: on a per-request instance "once" means once per call.

## Decision

1. **`captureModel` and `enableConversationId` default to `true`.** `reportMissing` and `collectFeedback` stay off: a virtual tool is a larger contract change than an argument, and both are being reworked separately.
2. **Unknown ownership reads `llm_model` and `conversation_id` the way ADR-0011 reads `context`.** Capture fails open; stripping fails closed. The `structuredContent` mirror keeps failing closed (ADR-0004), so on a cold instance the handle travels in `content` only.
3. **Preserve carried sessions until an agent echoes a handle.** A valid echoed handle still wins across reconnects. When a request already carries an MCP transport session or a PostHog session token, suppress new conversation minting and prompt-back delivery. Requests carrying neither keep the conversation fallback. This applies to both SDKs.
4. **Replaying the host listing on the call path stays rejected.** ADR-0011 stands; the catalog lookup was removed before merge.

Considered and rejected:

- **Split `captureModel` into an observing half (client `_meta`) and an injecting half (schema argument), and default on only the first.** Only Codex exposes model metadata today, so the observing half yields near-zero data for every other harness — it would delay the data the flip exists to collect. The object form (`captureModel: { description }`) leaves room for an `inject: false` knob later without a breaking change.
- **Advertise `llm_model` as optional rather than required.** `required` is advisory and never enforced (ADR-0002); agents fill required fields far more reliably, and `context` set the precedent.
- **An environment-variable override, or two staged releases.** Nothing else in the package reads the environment, and both flags share one opt-out line.

## Consequences

- A routine upgrade changes the advertised contract with no code change by the host: compatible tool schemas gain `llm_model` (required, advisory) and `conversation_id` (optional), and eligible tool results gain a prompt-back handle. `instrument(server, posthog, { captureModel: false, enableConversationId: false })` restores the previous shape. Ships as a minor, as `context` did.
- On a cold instance a host tool that declares its own `llm_model` is recorded under `$mcp_llm_model` with source `self_reported` until a listing proves otherwise — the same class of cost ADR-0011 accepted for `$mcp_intent`. A host-declared `conversation_id` that is not a uuidv7 is never trusted (ADR-0004), so a fresh handle is minted and prompted back.
- Unknown conversation ownership is a **read and write** tradeoff, unlike context: minting can append a content block even for a complex or application-owned schema that discovery would not extend. The carried-session guard prevents this on requests already carrying a session; it does not prove ownership on cold stateless instances. Disable `enableConversationId` for such tools when this contract is unsuitable. No undeclared structured-content field is written.
- Cold tools with an `outputSchema` still deliver the handle through `content` only. Clients that consume only `structuredContent` cannot echo it and their calls remain uncorrelated. The parameterized fresh-instance test explicitly covers this limitation; the passing C2 matrix rows only prove the content channel.
- Nothing is stripped on a cold instance; raw low-level handlers ignore extra keys. A high-level `McpServer` resolves ownership from its live registry per request and is unaffected.
- The harness's parked C2 low-level session rows now pass and are no longer excused.
- Cross-SDK contract: posthog-python applies the same defaults and the same read rule (PostHog/posthog-python#944).

## Representation and follow-ups

`ActiveAnalyticsParameterOwnership` now names both questions explicitly as `strip` and `read`, replacing ADR-0011's intermediate `contextOwnershipKnown` representation. This is an internal representation change; strip gates still require positive ownership.

Per-event conversation source (`minted` / `echoed`) and session source would help measure cooperation. They are deferred from this defaults release: the current event contract records the delivered handle but cannot measure echo rate directly. Adding these properties should specify both SDKs and failed-delivery behavior together. The carried-session fix prevents the concrete legacy-session regression without requiring those new properties.

## References

- PostHog/posthog-js#4924 (this change), PostHog/posthog-python#944 (Python twin)
- ADR-0002 (advisory `required`), ADR-0004 (conversation anchor, opt-in default), ADR-0009 (why the header mint survived), ADR-0011 (three-valued ownership, replay rejected)
- PostHog/posthog#64016 (roadmap)

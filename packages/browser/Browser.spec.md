# Browser

posthog-js, the main browser SDK: captures events, identifies people, evaluates flags and lazy-loads extensions such as session replay and surveys from the CDN.

## entrances

- public api: the host app calls posthog.init, capture, identify and the rest of the PostHog instance
  handler: PostHog in src/posthog-core.ts
  trust: host-app
- remote config: PostHog servers answer with the project's remote config, which turns features on and off
  handler: RemoteConfigLoader in src/remote-config.ts
  trust: posthog-api
- autocapture dom events: the visitor's clicks, changes and form submits reach the autocapture listener
  handler: Autocapture in src/autocapture.ts
  trust: visitor
- lazy-loaded extension script: a script from the PostHog CDN registers itself on window.**PosthogExtensions**
  handler: assignableWindow in src/utils/globals.ts
  trust: cdn
- compare array bundle size: a maintainer or CI compares the array bundle size against main
  handler: scripts/compare-array-bundle-size.mjs
  trust: maintainer

## invariants

- no capture while capturing is off: The browser SDK sends no event while capturing is off: before the visitor consents when consent is required, or after an opt-out outside cookieless mode.
  over: capture calls made while consent is pending in cookieless on_reject mode, which pass the same is_capturing check as every other capture
  via: should not send any events before opt in, then send non-cookieless events
  because: sending events before or against the visitor's consent breaks the customer's privacy promise and consent law such as GDPR; sdk-specs consent-gating, Scenario: Opted out consent blocks capture and persistence writes
  crossing: host-app -> egress
  entrances: public api
  kinds: output
  checklist: destination-confinement dismissed: this is about whether an event leaves, not where it goes; the host app sets api_host
  checklist: redaction declared as autocapture never sends password values
  checklist: commit-ordered-effects dismissed: no transaction comes before the send; consent is read before each capture
  checklist: circuit-breaker-policy dismissed: nothing here suppresses sends based on failures
  checklist: declared-target-coverage dismissed: events go to one destination; there is no fan-out
- autocapture never sends password values: Autocapture never puts the value of a password input into an event.
  over: the properties autocapture reads from a password input that has a value attribute
  via: should strip password element value
  because: a password typed by a visitor must never leave their browser; a leak would expose their account on the customer's site; sdk-specs autocapture, Requirement: Canonical autocapture behavior (password input scenario)
  crossing: visitor -> egress
  entrances: autocapture dom events
  kinds: output, credential
  checklist: capability-authorization dismissed: the SDK authorizes nothing with the password; it only must not copy it
  checklist: revalidated-permission dismissed: no deferred work acts with the visitor's permission
  checklist: destination-confinement dismissed: the rule is that the value never leaves, whatever the destination
  checklist: message-authenticity dismissed: no signed message is accepted here
  checklist: encrypted-storage dismissed: the value is never stored, so there is nothing to encrypt
  checklist: key-rotation-compatibility dismissed: no keys are involved
  checklist: redaction declared as autocapture never sends password values
  checklist: separation-of-duties dismissed: no approval roles are involved
  checklist: commit-ordered-effects dismissed: no transaction comes before the send
  checklist: circuit-breaker-policy dismissed: nothing here suppresses sends based on failures
  checklist: declared-target-coverage dismissed: events go to one destination; there is no fan-out

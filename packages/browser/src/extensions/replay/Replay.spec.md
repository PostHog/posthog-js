# Replay

Session replay in the browser SDK: decides when to record, runs the rrweb recorder from the lazy-loaded bundle, and buffers and sends the recording.

## entrances

- rrweb recorder events: the rrweb recorder hands replay the visitor's page changes, inputs and network requests
  handler: LazyLoadedSessionRecording in external/lazy-loaded-session-recorder.ts
  trust: visitor

## invariants

- an idle rotation sends no recording before interaction: When the session rotates after inactivity, replay sends none of the new session's recording until the visitor interacts, a trigger fires or the host app asks to record. If none of those happens, the held recording is thrown away.
  over: replay data buffered in a recording epoch that began with an idle-timeout rotation
  via: does not flush a rotation-born session on the timer without interaction
  because: an idle tab left open must not ship recordings nobody watched; sdk-specs session-replay-ingestion-controls, Requirement: Interaction hold for unconfirmed-activity recording epochs
  crossing: visitor -> egress
  entrances: rrweb recorder events
  kinds: output
  checklist: destination-confinement dismissed: this is about whether a recording leaves, not where it goes; the host app sets api_host
  checklist: redaction declared as replay redacts network bodies that may hold a password by default
  checklist: commit-ordered-effects dismissed: no transaction comes before the send; the hold is read at each flush
  checklist: circuit-breaker-policy dismissed: the hold depends on visitor activity, not on send failures
  checklist: declared-target-coverage dismissed: recordings go to one destination; there is no fan-out
- replay redacts network bodies that may hold a password by default: With no custom network masking callback, replay replaces any request or response body that may contain a password with a redaction notice.
  over: network request and response bodies replay records when the host app sets no maskRequestFn
  via: should redact password when no masking config is set
  because: a visitor's password must never reach a recording; sdk-specs session-replay-privacy, Scenario: Default body scrubbing runs without a custom callback
  crossing: visitor -> egress
  entrances: rrweb recorder events
  kinds: output, credential
  checklist: capability-authorization dismissed: replay authorizes nothing with the body; it only must not copy it
  checklist: revalidated-permission dismissed: no deferred work acts with the visitor's permission
  checklist: destination-confinement dismissed: the rule is that the body never leaves, whatever the destination
  checklist: message-authenticity dismissed: no signed message is accepted here
  checklist: encrypted-storage dismissed: replay keeps network bodies only in memory, so there is nothing to encrypt
  checklist: key-rotation-compatibility dismissed: no keys are involved
  checklist: redaction declared as replay redacts network bodies that may hold a password by default
  checklist: separation-of-duties dismissed: no approval roles are involved
  checklist: commit-ordered-effects dismissed: no transaction comes before the send
  checklist: circuit-breaker-policy dismissed: nothing here suppresses sends based on failures
  checklist: declared-target-coverage dismissed: recordings go to one destination; there is no fan-out

# Ai

@posthog/ai: wrappers and OpenTelemetry processing that capture LLM calls from AI provider clients as PostHog events.

## invariants

- privacy mode sends no prompts or outputs: When privacy mode is on, an AI generation event carries no prompt input and no model output.
  over: the $ai_input and $ai_output_choices properties of a generation captured through captureAiGeneration with privacyMode set
  via: redacts input and output when privacyMode is true
  because: customers turn on privacy mode so their users' prompts and the model's answers never reach PostHog; a leak would send personal or secret text; sdk-specs capture-ai, Requirement: Canonical capture_ai behavior (privacy mode takes precedence)
  crossing: host-app -> egress
  entrances: none
  kinds: output
  checklist: destination-confinement dismissed: the rule is about what the event holds, not where it goes
  checklist: redaction declared as privacy mode sends no prompts or outputs
  checklist: commit-ordered-effects dismissed: no transaction comes before the send
  checklist: circuit-breaker-policy dismissed: nothing here suppresses sends based on failures
  checklist: declared-target-coverage dismissed: events go to one destination; there is no fan-out

---
'@posthog/ai': minor
---

Add per-event options for posthog-node: `posthogOptions` on wrapped provider calls and `withTracing()`, and `options` on the LangChain, OpenAI Agents, Claude Agent SDK, Google ADK and Genkit integrations. An event with no distinct id still has person processing turned off. On posthog-node 6.x.x, AI events carry person processing only as the `process_person_profile` option. On posthog-node 5.x.x, each option that version knows is sent in the form it reads, and other keys are dropped. OpenAI Agents `instrument()` now passes every processor option, including `options` and `onError`, to the processor it registers.

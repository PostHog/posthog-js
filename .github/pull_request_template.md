## Problem

<!-- Who are we building for, what are their needs, why is this important? -->

## Changes

<!-- What is changed and what information would be useful to a reviewer? -->

## Release info Sub-libraries affected

### Libraries affected

<!-- Please mark which libraries will require a version bump. -->

- [ ] All of them
- [ ] posthog-js (web)
- [ ] posthog-js-lite (web lite)
- [ ] posthog-node
- [ ] posthog-react-native
- [ ] @posthog/react-native-plugin
- [ ] @posthog/react
- [ ] @posthog/ai
- [ ] @posthog/convex
- [ ] @posthog/next
- [ ] @posthog/nextjs-config
- [ ] @posthog/nuxt
- [ ] @posthog/openfeature-web-provider
- [ ] @posthog/rollup-plugin
- [ ] @posthog/webpack-plugin
- [ ] @posthog/types
- [ ] @posthog/browser-common

## Checklist

- [ ] Tests for new code
- [ ] Accounted for the impact of any changes across different platforms
- [ ] Accounted for backwards compatibility of any changes (no breaking changes!)
- [ ] Took care not to unnecessarily increase the bundle size

### If releasing new changes

- [ ] Ran `pnpm changeset` to generate a changeset file

<!-- For more details check RELEASING.md -->

## 🤖 Agent context

<!-- Fill this section if an agent co-authored or authored this PR. Remove it for fully human-authored PRs. -->

<!-- Autonomy — keep one of the two options on the line below:
     - "Human-driven (agent-assisted)" when a person directed the work — assign that person as the PR assignee (the DRI).
     - "Fully autonomous" when no human drove it; leave the PR unassigned for the owning team to triage. -->

**Autonomy:** Human-driven (agent-assisted) — or — Fully autonomous

<!-- Keep this short: 1-3 short paragraphs or a handful of bullets — not an exhaustive log. Include:
     - tools/agent used and link to session. List the agent and tool names used, but do not include tool call results.
     - decisions made along the way (what was tried, rejected, chosen, and why)
     - anything else that helps reviewers
     Write reviewer-facing prose. Do not paste user prompts verbatim — paraphrase the intent in your own words.
     DO NOT INCLUDE sensitive data that may have been shared in an agent session.
-->
<!-- Rules for agent-authored PRs:
     - When a human directed the work, the PR must be attributable to that person, even if agent-assisted.
     - If a human directed this work, assign them as the PR assignee (the DRI) — actually set the assignee, don't just name them here. Leave a PR unassigned only when it is fully autonomous with no human driver (set Autonomy to "Fully autonomous").
     - Do not add a human Co-authored-by just for the sake of attribution — if no human was involved in the changes, own it as agent-authored.
     - Agent-authored PRs always require human review — do not self-merge or auto-approve.
     - Do NOT claim manual testing you haven't done.
     - GitHub PR descriptions render markdown, not fixed-width text. Do not hard-wrap prose at a column width or use space-aligned tables — use real markdown tables, headings, and fenced code blocks, and let GitHub flow the text.
-->

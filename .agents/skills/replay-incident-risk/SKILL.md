---
name: replay-incident-risk
description: Cross-reference a posthog-js or rrweb change against past incident patterns before writing, reviewing, or merging it. Use when a diff touches session recording, the recorder or any lazy-loaded extension bundle (entrypoints/), session rotation or idle handling, fetch/XHR wrappers, rrweb record or replay code, recording triggers or remote config, or release workflows. Also use when asked "is this change risky", "could this repeat an incident", or "will this affect recording volume".
compatibility: Requires a posthog-js checkout with git history (origin/main reachable).
---

# Replay incident risk review

Changes to posthog-js and the rrweb fork have repeatedly caused severe incidents: fleet-wide recording loss, over-recording that inflated bills, broken customer sites, silent replay corruption, and a stored XSS. Most repeated through a small set of code-level patterns. This skill checks a diff against those patterns.

The registry of patterns and incidents lives next to this file: [INCIDENTS.md](./INCIDENTS.md). Read the matching class sections, not the whole file.

## Workflow

1. Run the mechanical matcher from the repo root:

    ```bash
    node .agents/skills/replay-incident-risk/check.mjs [base-ref] [head-ref]
    ```

    It diffs `HEAD` against `origin/main` by default and prints matched incident classes with the touched paths and risky added lines. It is advisory and always exits 0, even on internal errors.

    When changing `risk-map.json` itself, also run `check.mjs --validate`: it fails on path patterns matching no tracked file and on anchors that don't resolve to an INCIDENTS.md heading, so dead patterns can't rot silently. CI runs it on every PR.

2. For every matched class, open the class section in [INCIDENTS.md](./INCIDENTS.md) and answer its **review questions** against the diff. Answer them concretely (walk the code), not by assertion.

3. A path match is not a verdict. Judge whether the change actually has the failure mode:
    - **Lazy-load boundary**: does the change alter a contract (signature, persisted-state shape, expected core function) crossed by a lazy-loaded bundle? If yes, it deploys fleet-wide instantly, including to npm-pinned customers, and must degrade gracefully with old cores. Absent persisted fields are neutral, never fatal.
    - **Rotation/idle/flush**: could this change how many recordings ship? Walk an idle background tab through 24 hours and count what gets flushed and billed.
    - **Fetch/XHR wrappers**: highest bar. All body types, WebKit included, with a second fetch wrapper on the page. A failing real-browser test comes before the fix. No AI-generated changes here without a human owning every line.
    - **rrweb serialization**: silent-corruption risk. What real-browser assertion would notice this bug if it shipped?
    - **Replay reconstruction**: recorded content is untrusted. Allowlist attributes; nothing recorded may execute in the viewer's origin.
    - **Start conditions/config**: when the check can't be evaluated, is fail open vs fail closed a decision or an accident? Does it survive customer proxies stripping query params and headers?
    - **Delivery channel**: no `pull_request_target` with PR-code checkout, no lifecycle scripts, publish stays on trusted publishing.

4. Report findings in this shape, per matched class: the incident it resembles, whether this diff has the same failure mode (yes / no / can't tell), and if yes or can't tell, the smallest test or code change that removes the doubt. "Can't tell" is a finding, not a pass.

5. If the change plausibly moves recording volume fleet-wide, say so explicitly in the PR description and note that the recordings week-over-week anomaly alert should be watched for a day after release.

## When writing (not just reviewing) code in these areas

Run the check on your own diff before opening the PR. If your change matches the lazy-load boundary class, add or extend a compat test (old pinned core + new lazy bundle) covering your path, including cold start from persisted config with a delayed remote-config response. That gap is exactly how the two largest recorder incidents shipped.

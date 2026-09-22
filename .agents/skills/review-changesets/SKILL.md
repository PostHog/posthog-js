---
name: review-changesets
description: Review whether changesets cover the complete proposed posthog-js monorepo change, including local edits. Use when asked to validate changesets, check release-note coverage or bump levels, or prepare a publishable SDK change for submission. Not for publishing or release recovery.
compatibility: Requires a posthog-js checkout and Git; review does not require installed dependencies.
---

# Review changesets

## Source of truth

Read [RELEASING.md](../../../RELEASING.md), especially "Creating a changeset" and "Reviewing changesets". It owns release policy; do not substitute another repository's package list or semver rules. Follow the root [agent instructions](../../../AGENTS.md) for public API changes.

## Workflow

1. Establish the intended base from the user's request or the PR target. If it is unknown, ask rather than assuming `main`. Record the base ref and resolved merge-base commit. Do not switch branches or discard local changes.
2. Inspect the complete proposed diff. Useful read-only commands, with `<base-ref>` replaced by the confirmed ref:

    ```bash
    git status --short
    git merge-base HEAD <base-ref>
    git diff --name-status <merge-base>
    git diff <merge-base> -- packages tooling .changeset
    git ls-files --others --exclude-standard
    ```

    The diff against the merge base includes committed, staged, and unstaged tracked changes. Inspect relevant untracked files separately; they are absent from `git diff`. Review relevant changes elsewhere, such as root build configuration, too. If the base or files are unavailable, report incomplete coverage and request the missing context.

3. Read affected package manifests and identify consumer-visible effects, including published consumers of shared or vendored code. Inspect the contents of branch-added or modified changesets, not just their filenames. Apply the release guide's coverage, ownership, summary, and bump-review rules.
4. Report findings before editing. When the task authorizes corrections, update the relevant existing changeset or create one only when needed, then repeat the review against the complete diff. Do not modify runtime code to make a changeset appear correct.

## Report

- **Scope:** base ref, merge-base commit, and whether local/untracked changes were included.
- **Coverage:** published package, consumer-visible effect, and covering changeset (or reason none is needed).
- **Bump assessment:** recommendation and compatibility rationale; flag uncertainty for a maintainer.
- **Corrections:** missing coverage, duplicate or stale notes, or unrelated package entries.
- **Limitations:** missing context and outstanding questions. Distinguish a complete review from a partial one.

This skill does not grant permission to commit, push, publish, or run recovery workflows.

## Reference

Workflow inspiration: [OpenAI Agents JS changeset validation, pinned source](https://github.com/openai/openai-agents-js/blob/506f736a10014df5c6d7c68a9987594674d4fabb/.agents/skills/changeset-validation/SKILL.md). This is a repository-specific workflow, not an installation of its scripts or adoption of its release policies.

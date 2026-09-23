# Agent Instructions

- Read and follow [CONTRIBUTING.md](./CONTRIBUTING.md) before contributing to the SDKs. It contains repository structure, environment setup, development commands, testing, linting, dependency policies, and PR requirements.
- Read and follow [RELEASING.md](./RELEASING.md) when adding changesets or working on publishing or release recovery.
- Public API changes: follow "Public API changes" in [CONTRIBUTING.md](./CONTRIBUTING.md). As an agent, also:
    - When reviewing or fixing someone else's PR, don't ask for or open an issue, but note in the review when an external contributor's PR changes public API without one.
    - The author is a PostHog maintainer when the PR's `author_association` is `MEMBER` or `OWNER` (`gh api repos/PostHog/posthog-js/pulls/<number> --jq .author_association`) or, before a PR exists, when `gh api orgs/PostHog/members/$(gh api user --jq .login)` succeeds. If the check fails or can't run, treat the author as an external contributor.
    - For an external contributor with no agreed issue, stop before implementing and draft the issue body for the user to post. Open it only if they ask.
- Before implementing or reviewing SDK behavior, check [PostHog/sdk-specs](https://github.com/PostHog/sdk-specs) for a spec covering it (its README lists every capability). If one exists, use it as the cross-SDK contract for the behavior the PR changes, and call out any divergence in that behavior in the PR description. Don't fix or flag discrepancies between the spec and code the PR doesn't touch. If none exists, carry on.
- Check for package-level `AGENTS.md` files and contributor guides before working in a package.
- Keep shared development guidance in `CONTRIBUTING.md` and release guidance in `RELEASING.md` rather than duplicating it here.

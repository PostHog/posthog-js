# PostHog JavaScript package

[![npm package](https://img.shields.io/npm/v/posthog-js?style=flat-square)](https://www.npmjs.com/package/posthog-js)
[![MIT License](https://img.shields.io/badge/License-MIT-red.svg?style=flat-square)](https://opensource.org/licenses/MIT)

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [JavaScript library docs](https://posthog.com/docs/libraries/js)

## Agent skills

`posthog-js` bundles an official coding-agent skill at `skills/posthog-js/SKILL.md` along with local API references under `skills/posthog-js/references/`.

If you use `pnpm` 12.11 or later, `pnpm` detects the bundled skill on install and leaves it disabled until you explicitly approve it:

```bash
pnpm approve
```

Approving `posthog-js` symlinks `skills/posthog-js` into your project's agent skill directory (`.claude/skills/posthog-js` when `.claude/` exists, or `.agents/skills/posthog-js` otherwise). If you use another package manager, point your coding agent at `node_modules/posthog-js/skills/posthog-js/SKILL.md`.

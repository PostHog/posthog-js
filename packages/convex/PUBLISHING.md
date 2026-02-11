# Publishing

Releases are automated via GitHub Actions using [changesets](https://github.com/changesets/changesets).

## How to release

1. Before submitting your PR, run `pnpm changeset` to create a changeset file describing your changes. The CLI will prompt you for the version bump type (major/minor/patch) and a description.
2. Add the `release` label to your PR.
3. When the PR is merged to `main`, the release workflow will automatically:
   - Verify changesets exist
   - Request approval in Slack
   - Bump the version and update the changelog
   - Publish to npm with provenance
   - Create a GitHub release
   - Push a git tag

You can also trigger the release workflow manually via `workflow_dispatch` in GitHub Actions.

## Building a one-off package

```sh
rm -rf dist
pnpm build
pnpm pack
```

You can then provide the .tgz file to others to install via
`pnpm install ./path/to/posthog-convex.tgz`.

# Releasing

This repository uses [Changesets](https://github.com/changesets/changesets) for version management and an automated GitHub Actions workflow for releases.

## How to Release

### 1. Add a Changeset

When making changes that should be released, add a changeset:

```bash
pnpm changeset
```

This will prompt you to:
- Select the type of version bump (patch, minor, major)
- Write a summary of the changes

The changeset file will be created in the `.changeset/` directory.

### 2. Create a Pull Request

Create a PR with your changes and the changeset file(s).

### 3. Merge the PR

No release label is required. When the PR is merged to `main`, the release workflow will automatically:

1. Check for changesets
2. Notify the client libraries team in Slack for approval
3. Wait for approval from a maintainer (via GitHub environment protection)
4. Once approved:
   - Apply changesets and bump the version
   - Update the CHANGELOG.md
   - Commit the version bump to `main`
   - Publish the package to NPM
   - Create a git tag and GitHub release

### Manual Trigger

You can also manually trigger the release workflow from the [Actions tab](https://github.com/PostHog/posthog-react-native-plugin/actions/workflows/release.yml) by clicking "Run workflow".

## Version Bumping

Changesets handles version bumping automatically based on the changesets you create:

- **patch**: Bug fixes, documentation updates, internal changes (e.g., `1.2.3` → `1.2.4`)
- **minor**: New features, non-breaking changes (e.g., `1.2.3` → `1.3.0`)
- **major**: Breaking changes (e.g., `1.2.3` → `2.0.0`)

## Pre-release Versions

For pre-release versions (alpha, beta, RC), you can manually enter pre-release mode:

```bash
pnpm changeset pre enter alpha  # or beta, rc
pnpm changeset version
```

To exit pre-release mode:

```bash
pnpm changeset pre exit
```

## NPM Package

The package is published as [`posthog-react-native-plugin`](https://www.npmjs.com/package/posthog-react-native-plugin) on NPM.

## Troubleshooting

### No changesets found

If the release workflow fails with "No changesets found", ensure your PR includes at least one changeset file in the `.changeset/` directory.

### Release not triggered

Make sure the PR includes a changeset file and was merged to `main`, or trigger the workflow manually from the Actions tab.

### Manual NPM publish (emergency only)

In case of automation failure, you can manually publish:

```bash
pnpm install
pnpm prepare  # builds the package
npm publish
```

You'll need to be authenticated with NPM and have publish access to the package.

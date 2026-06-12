## Releases

Releases are managed with changeset, you can find more information on the [changeset repository](https://github.com/changesets/changesets).

Before submitting a PR, create a changeset by running:

```
pnpm changeset
```

CLI will prompt questions about the changes you've made and will generate a changeset file for you.

When a PR containing a changeset is merged to `main`, the release workflow will automatically:

1. Bump versions based on changesets
2. Commit version updates directly to main
3. Publish packages to npm
4. Create GitHub releases

# for posthog-js browser sdk

When we run post-merge actions for the browser SDK, the release workflow publishes the package to npm and uploads the browser bundles to S3 for the CDN.

The CDN upload happens in `.github/workflows/release.yml` via the `upload-s3` job. For a new stable `posthog-js` version it uploads:

- immutable versioned assets under `/static/<version>/`
- mutable major-version aliases under `/static/<major>/`
- top-level compatibility aliases under `/static/`

Prerelease versions only get immutable versioned assets.

A mismatch can still happen if npm publish succeeds but the S3/CDN upload fails: npm users may get version N+1 while CDN/snippet users remain on version N or see incomplete CDN assets until the failed upload is retried. The release workflow sends a partial-release Slack warning for this case.

PostHoggers can join the [#alerts-posthog-js channel in Slack](https://posthog.slack.com/archives/C07HTMN9X47), which gets notified about release workflow failures.

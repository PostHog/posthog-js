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

When we run post-merge actions for the browser SDK we publish to NPM

But then we automagically open a PR against the main PostHog repo. We don't update the CDN with the new version until that PR merges. So if it fails you can end up with html snippet users on version N and npm install on version N+1

PostHoggers can join the [#alerts-posthog-js channel in slack](https://posthog.slack.com/archives/C07HTMN9X47) which gets notified when those PRs fail

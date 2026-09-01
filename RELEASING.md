## Releases

Releases are managed with [Changesets](https://github.com/changesets/changesets).

Before submitting a PR with a publishable change, create a changeset by running:

```bash
pnpm changeset
```

The CLI will ask which packages changed, what version bump they need, and how the change should appear in the changelog.

When a PR containing a changeset is merged to `main`, the [`Release` workflow](https://github.com/PostHog/posthog-js/actions/workflows/release.yml) automatically:

1. Waits for approval and creates the version-bump commit on `main`.
2. If the version of the `posthog-js` browser package changed, builds and uploads its browser and toolbar assets to the US and EU S3 buckets.
3. Publishes the changed packages to npm.
4. Creates package tags and GitHub releases.
5. Dispatches downstream dependency upgrades and reports the result in Slack.

### Browser S3/CDN gate

The browser S3 release happens before npm publishing. When `posthog-js` changes, every npm publish job is gated on:

- successfully identifying the new browser version;
- building the browser distribution;
- building the toolbar for both regional asset hosts; and
- successfully uploading to both the US and EU S3 buckets.

If any of that work fails, no package from the coordinated npm release is published. If `posthog-js` did not change, the S3 jobs are skipped and npm publishing proceeds normally.

A stable browser release uploads:

- immutable versioned assets under `/static/<version>/`;
- mutable major-version aliases under `/static/<major>/`; and
- top-level compatibility aliases under `/static/`.

Prerelease versions receive only immutable versioned assets. The workflow does not purge CDN caches. Mutable aliases use `Cache-Control: public, max-age=300`, so they can continue serving cached bytes for up to five minutes. Versioned assets use `Cache-Control: public, max-age=31536000, immutable`.

PostHoggers can join [`#alerts-posthog-js`](https://posthog.slack.com/archives/C07HTMN9X47) for release workflow failure notifications.

## Manual S3 recovery

S3 recovery is an exceptional path for repairing a failed or incomplete browser release. If the failure was transient and the original run is still safe to resume, first retry its failed jobs. Use recovery when the original run cannot be completed safely, for example when one regional upload succeeded before the other failed or an existing release is missing immutable assets.

Recovery always rebuilds and uploads the browser SDK and toolbar. It is not an npm-only, alias-only, artifact-promotion, rollback, or S3 deletion mechanism. If a bad version is already live, ship a corrected patch and deprecate the bad npm version if needed. Do not use recovery to point mutable aliases at an earlier release.

### Starting recovery

1. Open the [`Release` workflow](https://github.com/PostHog/posthog-js/actions/workflows/release.yml).
2. Select **Run workflow** and run it from `main`.
3. Set `target_version` and review the recovery inputs below.
4. Confirm that **Validate recovery inputs** resolved the intended SDK version, SDK commit, and toolbar commit.
5. Have an eligible reviewer approve the protected `S3 Recovery` environment.
6. Monitor every requested regional build and upload, then verify the resulting assets.

After validation, the workflow notifies `#approvals-client-libraries` with the target, validated source commits, regions, and selected recovery options. Slack delivery is best-effort and does not bypass the protected approval.

### Recovery inputs

| Input                   | Default | Behavior                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target_version`        | empty   | Required S3 destination version, for example `1.418.2`.                                                                                                                                                                                                                                                                                                                     |
| `source_sha`            | empty   | Full `PostHog/posthog-js` commit to build. When empty, resolves the `posthog-js@<target_version>` tag. A version that never received a tag requires its full version-bump commit SHA. The commit must be current `main` or an ancestor.                                                                                                                                     |
| `toolbar_sha`           | empty   | Full `PostHog/posthog` commit used to build the toolbar. When empty, uses current `master`. The commit must be current `master` or an ancestor. Normal releases resolve `PostHog/posthog@master` at release time rather than pinning it to the SDK version. To reproduce a release, copy the toolbar commit from the original run's **Resolve toolbar source** job summary. |
| `region`                | `all`   | `all`, `us`, or `eu`. Updating latest aliases or publishing to npm requires `all`.                                                                                                                                                                                                                                                                                          |
| `update_latest_aliases` | `false` | Also updates `/static/` and `/static/<major>/`. Leave disabled for an older release or immutable-only repair.                                                                                                                                                                                                                                                               |
| `publish_to_npm`        | `false` | After both S3 regions succeed, publish and finalize an unpublished current `posthog-js` version. This requires latest aliases, both regions, `NPM Release` approval, and OIDC.                                                                                                                                                                                              |
| `force_overwrite`       | `false` | Allows existing immutable `/static/<version>/` objects to be replaced. By default the workflow refuses existing immutable assets and protects writes against races. Overwriting does not purge CDN caches.                                                                                                                                                                  |

S3-only recovery permits the selected SDK package version to differ from `target_version` so an explicitly reviewed source can repair a destination path. The resolved source version appears in the approval summary and Slack message. Approve a mismatch only when it is intentional; otherwise the destination path would identify bytes from a different package version.

Use `force_overwrite` only after checking which objects the earlier attempt created and confirming the selected SDK and toolbar commits. If immutable assets already exist, `force_overwrite=true` is required before the workflow writes anything, including aliases. Recovery still rebuilds and rewrites the immutable assets even when only the aliases are wrong.

### Approval and publication safeguards

Before selected source code is built, recovery validates that:

- the recovery workflow is running from `posthog-js@main`;
- the SDK source is current `PostHog/posthog-js@main` or an ancestor; and
- the toolbar source is current `PostHog/posthog@master` or an ancestor.

An independent `S3 Recovery` approval is then required before checking out and executing the selected sources. Actual bucket access uses AWS OIDC under `S3 Upload`.

Optional npm finalization is allowed only when the source and target versions match, the source is the current version-bump commit on `main`, and neither the npm version nor release tag already exists. It requires both regions and latest aliases, waits for S3 success, and runs under the protected `NPM Release` environment with npm OIDC.

### Regional failures

US and EU builds and uploads run independently. Requiring both regions before npm publishing prevents an npm-ahead-of-S3 release, but it does not make regional S3 writes atomic. One region can succeed before the other fails.

For an immutable-only retry, select only the failed region and leave latest aliases disabled. If a stable-alias update partially succeeds, inspect both regions and ask `#team-client-libraries` before retrying; alias updates require `region=all`.

### Verifying recovery

Verify representative immutable assets from both direct asset hosts:

```bash
set -euo pipefail
VERSION=1.418.2

for host in us-assets.i.posthog.com eu-assets.i.posthog.com; do
    for file in array.js recorder.js toolbar.js; do
        curl --fail --silent --show-error --output /dev/null \
            "https://${host}/static/${VERSION}/${file}"
    done
done
```

These requests verify availability, not the bytes held by every cache. After `force_overwrite`, inspect the upload jobs and compare a cache-busted response with the workflow's `s3-recovery-posthog-js-dist` artifact:

```bash
set -euo pipefail
RUN_ID=123456789
artifact_dir=$(mktemp -d)

gh run download "$RUN_ID" \
    --repo PostHog/posthog-js \
    --name s3-recovery-posthog-js-dist \
    --dir "$artifact_dir"

for host in us-assets.i.posthog.com eu-assets.i.posthog.com; do
    downloaded_file="$artifact_dir/${host}-array.js"
    curl --fail --silent --show-error \
        "https://${host}/static/${VERSION}/array.js?recovery-check=$(date +%s)" \
        --output "$downloaded_file"
    cmp "$artifact_dir/array.js" "$downloaded_file"
done
```

Immutable responses have long-lived cache headers, and recovery does not purge copies already held by browsers or CDN edges. A successful cache-busted comparison does not invalidate those older cached responses.

If latest aliases were updated, also verify `/static/array.js` and `/static/<major>/array.js` in both regions after allowing up to five minutes for their `max-age=300` cache lifetime.

If npm finalization was requested, verify npm, the tag, and the GitHub release:

```bash
set -euo pipefail

test "$(npm view "posthog-js@${VERSION}" version)" = "$VERSION"
test -n "$(git ls-remote --tags https://github.com/PostHog/posthog-js.git \
    "refs/tags/posthog-js@${VERSION}")"
gh release view "posthog-js@${VERSION}" \
    --repo PostHog/posthog-js \
    --json tagName,url
```

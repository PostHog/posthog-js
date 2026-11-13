## Releases

Releases are managed with [Changesets](https://github.com/changesets/changesets).

### Creating a changeset

Never add changesets for modules under `packages/rrweb/`; they are built with `posthog-js`. For rrweb changes that require a release, add only a `posthog-js` changeset.

Before submitting a PR with a publishable change, create a changeset by running:

```bash
pnpm changeset
```

The CLI will ask which packages changed, what version bump they need (major/minor/patch), and how the change should appear in the changelog. It creates a Markdown file in `.changeset/`.

Keep each changeset description to one short, user-facing line, similar to a PR title. State the fix or feature, not implementation details, test results, or the investigation history. Put longer explanations in the PR description or documentation.

### Publishing

Changes to `.changeset/` on `main` trigger the [`Release` workflow](https://github.com/PostHog/posthog-js/actions/workflows/release.yml). It can also be started through workflow dispatch. The workflow:

1. Waits for approval and creates the version-bump commit on `main`.
2. If the version of the `posthog-js` browser package changed, builds and uploads its immutable browser and toolbar assets to the US and EU S3 buckets. Only after both regions verify successfully does a second phase promote the major-version and compatibility aliases, using the same build artifacts.
3. Publishes the changed packages to npm.
4. Creates package tags and GitHub releases.
5. Dispatches downstream dependency upgrades and reports the result in Slack.

### Electron alpha releases

`@posthog/electron` has an **independent, manual alpha path**, not a coordinated stable release. Its manifest currently contains `0.1.0-alpha.0`; the release job does not rewrite it. Electron is intentionally absent from `release.yml`'s npm matrix and is in `.changeset/config.json`'s `ignore` list. Do not add it to the stable matrix, run monorepo-wide `changeset pre enter`, or promote `latest` to release an alpha.

Implementation PRs keep the package `private: true` and cannot publish Electron. Only the final, separately reviewed alpha-release PR removes that flag and enables the protected manual path below; merging it still does not publish automatically.

During alpha:

- Do **not** add Electron entries to `.changeset/*.md`, including mixed Electron/core changesets. Changesets rejects mixing ignored and released packages; a normal minor bump on an alpha manifest can also produce a stable version.
- Keep changesets for shared dependency changes (core/browser-common) as ordinary, separate stable changesets. The former mixed `electron-sdk-alpha.md` now releases **core only**, for the new context-safe flags and batch-retention hooks.
- Set each next Electron `x.y.z-alpha.N` version deliberately in a reviewed PR, with a short user-facing release note in that PR. The manifest's `publishConfig` fixes public access, the npm registry and the `alpha` dist-tag as defense in depth. Pack with pnpm so `workspace:^` becomes the real registry `^<workspace version>` dependency; do not bundle unreleased core as a workaround.
- Stable/GA onboarding (removing the ignore, adding the stable matrix entry, changeset/version policy and `latest` promotion) requires a separate review. This workflow never performs it. Electron needs no CDN publication.

#### External release gates (not established by this PR)

1. Merge the dependency stack and obtain independent review. Record the exact immutable source SHA and alpha version to be published; it must equal the trusted main workflow dispatch-head SHA (`github.sha`) and pass main-ancestry validation. Older ancestor publication is deliberately unsupported: npm provenance records the dispatch SHA, not merely the checkout ref. Confirm the final packed exports/docs include the merged API/DOM/React/utility work, not just the base analytics implementation.
2. **Release core first**, including `getFlagsForContext` and `shouldRetainBatchOnError`; if DOM integration needs the new browser-common type seam, release that package first as well. The packed Electron manifest's dependency **lower bounds** must identify versions containing these changes. A local core override in the example/compliance fixture proves nothing about registry availability. If the current workspace version predates the hooks, update it through the ordinary reviewed dependency release, then repack Electron. Never merely rely on a newer version satisfying an older incompatible lower bound.
3. Wait the seven-day dependency cooldown. The independent consumer sets `minimumReleaseAge: 10080`, pins pnpm 11.7.0 and resolves real registry lower bounds without overrides or the repository's tarball-rewriting pnpmfile. It checks both core hooks and strict installed declarations for every packed entrypoint (including browser-common references). Missing versions/hooks/types, lookup/auth/network errors and immature dependencies **fail**, not skip. This is an install/type gate, not a real Electron runtime or behavioral conformance test.
4. Record green installed/packaged runtime evidence for the supported OS/Electron matrix and published sdk-spec harness scenarios. Only macOS runtime execution is locally proven so far; Windows/Linux CI and published-harness acceptance remain open. Record any agreed contract divergence, including Electron desktop lifecycle mapping. Review authenticated-proxy limitations, consent/accepted-queue semantics, ownership/manual recovery and host-owned awaited shutdown with the alpha approver.
5. An npm organization/package owner must confirm name availability, scope rights, initial publication policy and trusted-publisher configuration. Public `npm view` is not proof of publish permission. No npm publication or npm privilege configuration is established by these checks.

#### Maintainer environment and npm bootstrap

The repository administrator has configured and verified the GitHub environment **`Electron Alpha NPM`** with the existing SDK approver teams (IDs `16072747` and `11787281`), self-review prevented, administrator bypass disabled, and a `main`-only custom deployment policy (ID `66476999`). Recheck these protections before enabling publication; naming an environment in a workflow alone does not establish them. This GitHub setup does **not** establish npm package-creation rights, bootstrap approval or trusted-publisher configuration, which remain pending. Keep credentials out of this environment; only the publish job gets `id-token: write`, and `contents: read` is sufficient (no automatic tag/commit/release creation).

An npm package owner configures its trusted publisher under **npm → `@posthog/electron` → Settings → Trusted publishing**: GitHub Actions, organization `PostHog`, repository `posthog-js`, workflow filename **`release-electron-alpha.yml`**, environment **`Electron Alpha NPM`**. Require npm's supported modern CLI (Node 24's bundled npm must support OIDC/provenance; npm 11.5.1+). Use GitHub-hosted runners. The publish command requests provenance explicitly and has no token fallback.

If npm cannot configure a trusted publisher before the package's first publication, **stop the OIDC path**. A maintainer with `@posthog` package-creation/publish rights must approve and perform a bootstrap outside this session. Download and verify the reviewed validation run's tarball/digest; authenticate interactively with npm (`npm login --registry https://registry.npmjs.org`, satisfying organization 2FA), then publish **that exact tarball** with `npm publish ./electron.tgz --ignore-scripts --access public --tag alpha --registry https://registry.npmjs.org`. Local bootstrap does not provide GitHub OIDC provenance; explicitly approve that exception or arrange a separately reviewed provenance-capable bootstrap. Do not add a long-lived token to this workflow to bypass the missing setup. Configure the trusted publisher afterward, remove/revoke bootstrap credentials as appropriate, and use a **new reviewed alpha version** for the OIDC workflow: published versions are immutable and rerunning the bootstrap version must fail. If provenance is mandatory for the very first version, publication stays blocked until a maintainer provides an approved bootstrap path.

#### Validation and later manual publication

Run [Electron alpha release](.github/workflows/release-electron-alpha.yml) from `main`, supply the full reviewed **dispatch-head** `source_sha` (exactly this run’s immutable `github.sha`) and matching `version`, and leave `publish=false` for rehearsal. It uses Node 24, pnpm 11.7.0, SHA-pinned actions, frozen workspace installation, focused release/dependency/build/type/unit/export checks, pnpm packing, a real registry consumer and an immutable artifact/digest. Rehearsal has **no npm OIDC permission and no publish dry-run**; even pnpm dry-run can request an OIDC token. The workflow does not prove the external runtime/harness gates automatically.

Only after all gates above pass, dispatch with `publish=true`. The protected-environment reviewer must check those external results and the build summary's source SHA, version, fixed `alpha` tag, registry and tarball SHA-256 before approving. The publish job downloads the same artifact (does not rebuild), verifies the digest, rechecks exact dispatch-head source/main ancestry/absent package tag/unpublished npm version/dependency age, and publishes **only that Electron tarball** using npm OIDC/provenance and `--ignore-scripts`. Any registry error other than an explicit target-package 404 fails closed. No other SDK, stable alias, downstream upgrade or automatic stable promotion is published.

After success, verify `npm view @posthog/electron@<version> version dist.integrity dist.attestations --json --registry https://registry.npmjs.org` and `npm view @posthog/electron dist-tags --json`. Confirm `alpha` points to the intended version and no stable `latest` was changed (a first-publish bootstrap needs explicit dist-tag inspection). A maintainer may then create a **signed** `@posthog/electron@<version>` git tag at the reviewed source SHA and a GitHub prerelease manually. This workflow deliberately has no repository-write permission. If npm succeeded but follow-up work failed, verify the immutable registry version rather than republishing it; fix forward with another reviewed alpha version. Retain the original artifact for inspection. Run `pnpm test:electron-alpha-release` for stable-discovery/isolation regression tests.

### `posthog-js` S3/CDN gate

The `posthog-js` S3 release happens before npm publishing. When `posthog-js` changes, every npm publish job is gated on:

- successfully identifying the new browser version;
- building the browser distribution;
- building the toolbar for both regional asset hosts; and
- successfully uploading and verifying immutable assets in both the US and EU S3 buckets; and
- successfully promoting and verifying aliases in both regions (prereleases verify immutable assets but do not write aliases).

If any of that work fails, no package from the coordinated npm release is published. If `posthog-js` did not change, its S3 jobs are skipped and npm publishing proceeds normally.

A stable `posthog-js` release uploads:

- immutable versioned assets under `/static/<version>/`;
- mutable major-version aliases under `/static/<major>/`; and
- top-level compatibility aliases under `/static/`.

The integrity manifest is published only under `/static/<version>/integrity.json`, never at the mutable aliases.

Prerelease versions receive only immutable versioned assets. The workflow does not purge CDN caches. Mutable aliases use `Cache-Control: public, max-age=300`, so they can continue serving cached bytes for up to five minutes. Versioned assets use `Cache-Control: public, max-age=31536000, immutable`.

### `@posthog/browser` S3 publication

S3 publication runs independently of npm publication. The workflow compares `packages/browser-next/package.json` at the pinned Changesets version-bump commit with its parent and publishes S3 assets when its version changed. This decision remains the same on retries, regardless of npm publication status.

The workflow builds `pnpm --filter @posthog/browser build:cdn` once from the pinned Changesets version-bump commit, after building workspace dependencies. Both regions and phases consume the same `posthog-browser-dist` artifact, containing `script.js`, deferred chunks, and source maps.

Stable releases publish byte-identical trees at:

- `/static/browser/<exact-package-version>/` with `Cache-Control: public, max-age=31536000, immutable`;
- `/static/browser/<major>/` with `Cache-Control: public, max-age=300`.

Prereleases publish only the exact-version tree. Dependencies are uploaded and verified before `script.js` in both phases. Historical hashed chunks are retained for cached entries. Alias promotion is not atomic across objects or regions and does not purge CDN caches.

Before stable alias promotion, the workflow requires the release version to match the current package version on `main`. Superseded retries can repair immutable URLs but cannot promote aliases, even if the newer version's S3 publication failed; retry the latest release instead. When running the phases manually, confirm the target version matches `main` before promoting aliases.

```sh
node tooling/release/src/cli.ts upload-browser-s3 "$BUCKET" "$VERSION" --immutable-only
# After immutable uploads succeed in both US and EU:
node tooling/release/src/cli.ts upload-browser-s3 "$BUCKET" "$VERSION" --aliases-only
```

Both phases use the shared checksum, metadata, conditional-write, concurrency, and retry helpers below. Alias promotion re-verifies immutable assets. Keep the original artifact for retries; it is retained for 30 days. If it is unavailable, publish a new version rather than rebuilding into an immutable path. The manual recovery workflow below applies to `posthog-js`.

**Deployment prerequisite:** confirm both asset-bucket OIDC roles can HEAD/GET and conditionally PUT the `static/browser/` prefix, and both asset CDNs serve it with the uploaded MIME/cache metadata. Local tests do not establish IAM authorization or public availability.

### Retry and resume behavior

S3 operations run with at most eight assets in flight per job. Each PUT uses a replayable buffer and the AWS SDK's standard retry strategy (exponential backoff with jitter, at most four attempts). Started operations drain before a failed phase exits; subsequent phases do not start on failure.

A retry checks existing immutable objects against the local artifact's SHA-256, length, content type, cache control, and absence of content encoding. Identical objects are skipped, missing objects are uploaded with `If-None-Match: *`, and conflicting objects fail without overwriting. Older objects without a full-object SHA-256 are downloaded and hashed; ETag is not treated as a content checksum. Permission and lookup failures are not treated as missing objects. A conditional-write conflict after a lost acknowledgement is accepted only after verifying the existing object matches.

For `posthog-js`, keep the original SDK and regional toolbar artifacts when retrying. A rebuild from the same commit is not necessarily byte-identical, and a different toolbar revision must not silently replace immutable assets. Only explicitly approved recovery may force replacement of conflicting objects.

The `posthog-js` CLI retains its combined upload mode for compatibility. Workflows use `upload-s3 <bucket> <version> --immutable-only`, followed by `--aliases-only` behind a cross-region barrier. Alias-only mode re-verifies the complete immutable set before writing aliases and cannot be combined with `--force-overwrite` or `--immutable-only`. No compressed asset format, public path, or cache lifetime changes are introduced.

PostHoggers can join [`#alerts-posthog-js`](https://posthog.slack.com/archives/C07HTMN9X47) for release workflow failure notifications.

### Failed or cancelled release

The independent [release failure notification workflow](.github/workflows/release-failure-notification.yml) checks every completed release attempt on `main` and on the `posthog-node-5` maintenance branch, and alerts if a job failed, timed out, or was cancelled. This includes runner startup failures and cancellations with job records. It also alerts when the run did not succeed, no job failed, and an npm publish job (`Publish packages` or `Publish posthog-js`) was never created, for example when GitHub Actions stops a run before the publish jobs start. Maintenance runs skip `Publish posthog-js`, so only `Publish packages` counts there. Once every npm publish job succeeds, alerts describe follow-up problems rather than claiming the release failed, and the workflow alerts if the released Slack notification was skipped. It only acts on runs that a push or a manual dispatch started in this repository.

Cancelled runs with no jobs are ignored, including superseded queued runs and manual cancellations before any job is created. A version-bump failure before any steps ran is also ignored when the rejection-reply step confirms an explicit rejection in the same attempt and no other job failed.

Job inspection retries transient GitHub API failures up to three times. If inspection still fails, it logs the HTTP status or error type and message, then posts a fallback alert with the overall run status and logs link so the release can be checked manually. Error diagnostics stay in the run log, not in the Slack message.

Alerts reply to the approval thread in the release approvals Slack channel. The release workflow preserves the thread timestamp in a run artifact for 30 days, independently of release approval. Failed-job reruns reuse the latest available thread from the same or an earlier attempt. If the timestamp is missing, invalid, or unavailable, the alert falls back to a new channel message, so it does not depend on the approval notification succeeding. The failure message surfaces Slack API errors rather than silently ignoring them. The notification workflow must be present on the default branch to run.

## Manual S3 recovery

S3 recovery is an exceptional path for repairing a failed or incomplete browser release. If the failure was transient and the original run is still safe to resume, first retry its failed jobs. Use recovery when the original run cannot be completed safely, for example when one regional upload succeeded before the other failed or an existing release is missing immutable assets.

Recovery always rebuilds the browser SDK and toolbar, then uploads missing assets or verifies matching ones. It is not an npm-only, alias-only, artifact-promotion, rollback, or S3 deletion mechanism. If a bad version is already live, ship a corrected patch and deprecate the bad npm version if needed. Do not use recovery to point mutable aliases at an earlier release.

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
| `force_overwrite`       | `false` | Allows existing immutable `/static/<version>/` objects to be replaced. By default identical immutable assets are verified and skipped; conflicting assets are refused, and conditional writes protect against races. Overwriting does not purge CDN caches.                                                                                                                 |

S3-only recovery permits the selected SDK package version to differ from `target_version` so an explicitly reviewed source can repair a destination path. The resolved source version appears in the approval summary and Slack message. Approve a mismatch only when it is intentional; otherwise the destination path would identify bytes from a different package version.

Use `force_overwrite` only after checking which objects the earlier attempt created and confirming the selected SDK and toolbar commits. Matching immutable assets no longer require overwrite permission; different bytes or HTTP metadata still require an explicitly reviewed `force_overwrite=true` repair. Recovery rebuilds artifacts and uploads or verifies the immutable assets before alias promotion. Force applies only to the immutable phase; alias promotion always verifies the rebuilt artifacts match the stored immutable objects.

### Approval and publication safeguards

Before selected source code is built, recovery validates that:

- the recovery workflow is running from `posthog-js@main`;
- the SDK source is current `PostHog/posthog-js@main` or an ancestor; and
- the toolbar source is current `PostHog/posthog@master` or an ancestor.

An independent `S3 Recovery` approval is then required before checking out and executing the selected sources. Actual bucket access uses AWS OIDC under `S3 Upload`.

Optional npm finalization is allowed only when the source and target versions match, the source is the current version-bump commit on `main`, and neither the npm version nor release tag already exists. It requires both regions and latest aliases, waits for S3 success, and runs under the protected `NPM Release` environment with npm OIDC.

### Regional failures

US and EU immutable uploads run independently. Neither region starts alias promotion until every requested region's immutable upload and verification succeeds. Recovery uses the same barrier; alias updates still require `region=all`. This prevents an immutable-upload failure from exposing new aliases in just one region, but alias promotion itself remains non-atomic across objects and regions. If an alias phase fails, some aliases may already be updated; npm remains blocked until both regions succeed.

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

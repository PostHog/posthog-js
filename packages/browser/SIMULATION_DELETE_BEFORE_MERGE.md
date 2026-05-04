# Changeset hygiene simulation marker

This file exists only to verify the new shared `changeset-hygiene` workflow
in PostHog/.github with the `forbidden-major-packages: posthog-js` input.

It's a no-op file inside `packages/browser/` (the directory for the
`posthog-js` package) paired with a changeset that intentionally declares
a `'posthog-js': major` bump. The shared workflow should post a sticky
comment warning that posthog-js should never receive a major bump.

Delete this file (and the matching changeset) before merging.

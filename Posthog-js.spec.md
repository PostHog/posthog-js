# PostHog JS

The PostHog JavaScript SDKs: browser, server, mobile and framework packages that capture events, identify people and evaluate feature flags for apps that use PostHog.

## trust levels

- host-app (outside): the customer's app code that calls the SDK and the config it passes in
- visitor (outside): the end user's page or device: the DOM, inputs, URLs, cookies and storage, any of which they can change
- posthog-api (outside): responses from PostHog servers: remote config, flags and surveys
- cdn (outside): scripts the browser SDK lazy-loads from the PostHog CDN at run time
- build (outside): the customer's build: bundler hooks, env vars and the PostHog CLI the build plugins run
- sdk-state: the SDK's own in-memory and persisted state
- maintainer: repository maintainers and CI running the repository's own scripts
- egress: what leaves the device or server for PostHog

## entrances

- check package tarballs: a maintainer or CI checks the packed SDK tarballs before release
  handler: scripts/check-package-tarballs.js
  trust: maintainer
- check public api: a maintainer or CI compares the public API against the committed references
  handler: scripts/check-public-api.js
  trust: maintainer
- test dev watch: a maintainer or CI tests the dev watch build loop
  handler: scripts/test-dev-watch.mjs
  trust: maintainer

## invariants

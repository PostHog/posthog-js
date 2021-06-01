# PostHog.js

[![npm package](https://img.shields.io/npm/v/posthog-js?style=flat-square)](https://www.npmjs.com/package/posthog-js)
[![MIT License](https://img.shields.io/badge/License-MIT-red.svg?style=flat-square)](https://opensource.org/licenses/MIT)

Please see the main [PostHog docs](https://posthog.com/docs).

Specifically, the [JS integration](https://posthog.com/docs/integrations/js-integration) details.

## Testing

Unit tests: run `yarn test`
Cypress: run `yarn serve` to have a test server running and separately `yarn cypress` to launch Cypress test engine

### Running TestCafe E2E tests with BrowserStack

Testing on IE11 requires a bit more setup.

1. Run `posthog` locally on port 8000 (`DEBUG=1 TEST=1 ./bin/start`)
2. Run `python manage.py setup_dev --no-data` on posthog repo, which sets up a demo account
3. Optional: rebuild array.js on changes: `nodemon -w src/ --exec bash -c "yarn build-array"`
4. Export browserstack credentials: `export BROWSERSTACK_USERNAME=xxx BROWSERSTACK_ACCESS_KEY=xxx`
5. Run tests: `npx testcafe "browserstack:ie" testcafe/e2e.spec.js`

## Developing together with another repo

Update dependency in package.json to e.g. `"posthog-js": "link:../posthog-js"`, `yarn` and run `yarn build && yarn build-module`

## Releasing a new version

Add a label `bump X` label to a PR before merging (e.g. `bump patch`).

This will create a new npm version, update tags, changelog and create a PR [in the main repo](https://github.com/posthog/posthog).

### Alternative (manual) 

To release a new version, make sure you're logged in to NPM (`npm login`)

We tend to follow the following steps:

1. Merge your changes into master
2. Release changes as a beta version
    - `npm version 1.x.x-beta.0`
    - `npm publish --tag beta`
    - `git push --tags`
3. Create a PR linking to this version [in the main repo](https://github.com/posthog/posthog)
4. Once deployed and tested, write up CHANGELOG.md, and commit.
5. Release a new version
    - `npm version 1.x.x`
    - `npm publish`
    - `git push --tags`
6. Create a PR linking to this version [in the main repo](https://github.com/posthog/posthog)

## Questions?

### [Join our Slack community.](https://join.slack.com/t/posthogusers/shared_invite/enQtOTY0MzU5NjAwMDY3LTc2MWQ0OTZlNjhkODk3ZDI3NDVjMDE1YjgxY2I4ZjI4MzJhZmVmNjJkN2NmMGJmMzc2N2U3Yjc3ZjI5NGFlZDQ)

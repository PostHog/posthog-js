# PostHog.js

Please see the main [PostHog docs](https://posthog.com/docs).

Specifically, the [JS integration](https://posthog.com/docs/integrations/js-integration) details.

## Testing

Unit tests: run `yarn test`
Cypress: `yarn cypress`

## Developing together with another repo

Update dependency in package.json to e.g. `"posthog-js": "link:../posthog-js"`, `yarn` and run `yarn build && yarn build-module`

## Releasing a new version

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

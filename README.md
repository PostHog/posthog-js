# PostHog Browser JS Library

[![npm package](https://img.shields.io/npm/v/posthog-js?style=flat-square)](https://www.npmjs.com/package/posthog-js)
[![MIT License](https://img.shields.io/badge/License-MIT-red.svg?style=flat-square)](https://opensource.org/licenses/MIT)

Please see [PostHog Docs](https://posthog.com/docs).
Specifically, [browser JS library details](https://posthog.com/docs/libraries/js).

## Testing

Unit tests: run `yarn test`.
Cypress: run `yarn serve` to have a test server running and separately `yarn cypress` to launch Cypress test engine.

### Running TestCafe E2E tests with BrowserStack

Testing on IE11 requires a bit more setup. TestCafe tests will use the
playground application to test the locally built array.full.js bundle. It will
also verify that the events emitted during the testing of playground are loaded
into the PostHog app. By default it uses https://app.posthog.com and the
project with ID 11213. See the testcafe tests to see how to override these if
needed. For PostHog internal users ask @benjackwhite or @hazzadous to invite you
to the Project. You'll need to set `POSTHOG_API_KEY` to your personal API key, and
`POSTHOG_PROJECT_KEY` to the key for the project you are using.

You'll also need to sign up to [BrowserStack](https://www.browserstack.com/).
Note that if you are using CodeSpaces, these variables will already be available
in your shell env variables.

After all this, you'll be able to run through the below steps:

1. Optional: rebuild array.js on changes: `nodemon -w src/ --exec bash -c "yarn build-rollup"`.
1. Export browserstack credentials: `export BROWSERSTACK_USERNAME=xxx BROWSERSTACK_ACCESS_KEY=xxx`.
1. Run tests: `npx testcafe "browserstack:ie" testcafe/e2e.spec.js`.

### Running local create react app example

You can use the create react app setup in `playground/nextjs` to test posthog-js as an npm module in a Nextjs application.

1. Run `posthog` locally on port 8000 (`DEBUG=1 TEST=1 ./bin/start`).
2. Run `python manage.py setup_dev --no-data` on posthog repo, which sets up a demo account.
3. Copy posthog token found in `http://localhost:8000/project/settings` and then
4. `cd playground/nextjs`and run `NEXT_PUBLIC_POSTHOG_KEY='<your-local-api-key>' yarn dev`

### Tiers of testing

1. Unit tests - this verifies the behavior of the library in bite-sized chunks. Keep this coverage close to 100%, test corner cases and internal behavior here
2. Cypress tests - integrates with a real chrome browser and is capable of testing timing, browser requests, etc. Useful for testing high-level library behavior, ordering and verifying requests. We shouldn't aim for 100% coverage here as it's impossible to test all possible combinations.
3. TestCafe E2E tests - integrates with a real posthog instance sends data to it. Hardest to write and maintain - keep these very high level

## Developing together with another repo

#### Developing with main PostHog repo

The `posthog-js` snippet for a website loads static js from the main `PostHog/posthog` repo. Which means, when testing the snippet with a website, there's a bit of extra setup required:

1. Run `PostHog/posthog` locally
2. Link the `posthog-js` dependency to your local version (see below)
3. Run `yarn start` in `posthog-js`. (This ensures `dist/array.js` is being generated)
4. In your locally running `PostHog/posthog` build, run `yarn copy-scripts`. (This copies the scripts generated in step 3 to the static assets folder for `PostHog/posthog`)

Further, it's a good idea to modify `start-http` script to add development mode: `webpack serve --mode development`, which doesn't minify the resulting js (which you can then read in your browser).

### Using Yalc to link local packages

Run `npm install -g yalc`

-   In the posthog-js repo
    -   Run `yalc publish`
-   In the posthog repo
    -   Run `yalc add posthog-js && pnpm i && pnpm copy-scripts`

#### When making changes

-   In the posthog-js repo
    -   Run `yalc publish`
-   In the posthog repo
    -   Run `yalc update && pnpm i && pnpm copy-scripts`

#### To remove the local package

-   In the posthog repo
    -   run `yalc remove posthog-js`
    -   run `yarn install`

## Releasing a new version

Just bump up `version` in `package.json` on the main branch and the new version will be published automatically,
with a matching PR in the [main PostHog repo](https://github.com/posthog/posthog) created.

It's advised to use `bump patch/minor/major` label on PRs - that way the above will be done automatically
when the PR is merged.

Courtesy of GitHub Actions.

### Manual steps

To release a new version, make sure you're logged into npm (`npm login`).

We tend to follow the following steps:

1. Merge your changes into master.
2. Release changes as a beta version:
    - `npm version 1.x.x-beta.0`
    - `npm publish --tag beta`
    - `git push --tags`
3. Create a PR linking to this version in the [main PostHog repo](https://github.com/posthog/posthog).
4. Once deployed and tested, write up CHANGELOG.md, and commit.
5. Release a new version:
    - `npm version 1.x.x`
    - `npm publish`
    - `git push --tags`
6. Create a PR linking to this version in the [main PostHog repo](https://github.com/posthog/posthog).


## Questions?

### [Join our Slack community.](https://posthog.com/slack)

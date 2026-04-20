# Contributing

This guide covers package-specific development for `posthog-js` in `packages/browser`.

For repository-wide setup, see the root [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Testing

> [!NOTE]
> Run `pnpm build` at least once before running tests.

- Unit tests: run `pnpm test`.
- Cypress: run `pnpm start` to have a test server running and separately `pnpm cypress` to launch Cypress test engine.
- Playwright: run e.g. `pnpm exec playwright test --ui --project webkit --project firefox` to run with UI and in webkit and firefox.

### Running TestCafe E2E tests with BrowserStack

Testing on IE11 requires a bit more setup. TestCafe tests use the playground application to test the locally built `array.full.js` bundle. They also verify that the events emitted during the testing of playground are loaded into the PostHog app. By default this uses `https://us.i.posthog.com` and the project with ID `11213`. See the TestCafe tests to override these if needed. PostHog internal users can ask `@benjackwhite` or `@hazzadous` for access. You will need to set `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_API_KEY`.

You'll also need a [BrowserStack](https://www.browserstack.com/) account. If you are using CodeSpaces, these variables will already be available in your shell environment.

After all this, run:

1. Optional: rebuild `array.js` on changes: `nodemon -w src/ --exec bash -c "pnpm build-rollup"`.
2. Export BrowserStack credentials: `export BROWSERSTACK_USERNAME=xxx BROWSERSTACK_ACCESS_KEY=xxx`.
3. Run tests: `npx testcafe "browserstack:ie" testcafe/e2e.spec.js`.

### Running the local create react app example

You can use the create react app setup in `packages/browser/playground/nextjs` to test `posthog-js` as an npm module in a Next.js application.

1. Run `posthog` locally on port `8000` (`DEBUG=1 TEST=1 ./bin/start`).
2. Run `python manage.py setup_dev --no-data` on the `posthog` repo to set up a demo account.
3. Copy the project API key from `http://localhost:8000/project/settings` for the last step.
4. Run `cd packages/browser/playground/nextjs`.
5. Run `pnpm install-deps` to install dependencies.
6. Run `NEXT_PUBLIC_POSTHOG_KEY='<your-local-api-key>' NEXT_PUBLIC_POSTHOG_HOST='http://localhost:8000' pnpm dev` to start the application.

### Tiers of testing

1. Unit tests - verify behavior in small, focused chunks.
2. Browser tests - run in real browsers to cover timing, browser requests, and other high-level behavior.
3. TestCafe E2E tests - integrate with a real PostHog instance and should stay very high level.

## Developing together with another project

Install pnpm to link a local version of `posthog-js` in another JS project:

```bash
npm install -g pnpm
```

### Run this to link the local version

There are two options for linking this project to your local version: via [`pnpm link`](https://docs.npmjs.com/cli/v8/commands/npm-link) or via [local paths](https://docs.npmjs.com/cli/v9/configuring-npm/package-json#local-paths).

#### Local paths (preferred)

- Run `pnpm build` and `pnpm package` in the root of this repo to generate a tarball of this project.
- Run `pnpm -r update posthog-js@file:[ABSOLUTE_PATH_TO_POSTHOG_JS_REPO]/target/posthog-js.tgz` in the root of the repo that you want to link to (for example the main PostHog repo).
- Run `pnpm install` in that same repo.
- Run `cd frontend && pnpm run copy-scripts` if the repo you want to link to is the main PostHog repo.

After the link has been created, any time you need to make a change to `posthog-js`, run `pnpm build && pnpm package` from the `posthog-js` root and the changes will appear in the other repo.

#### `pnpm link`

- In the `posthog-js` directory: `pnpm link --global`
- For `posthog`: `pnpm link --global posthog-js && pnpm i && pnpm copy-scripts`
- Remove the link by running `pnpm unlink --global posthog-js` from within the consuming repo.

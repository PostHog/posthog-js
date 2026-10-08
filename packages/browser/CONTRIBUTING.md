# Contributing

This guide covers package-specific development for `posthog-js` in `packages/browser`.

For repository-wide setup, see the root [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Development

After the initial build, run `pnpm dev` (or `pnpm start`) in this package to watch source changes. This runs TypeScript emission, Rolldown runtime bundling and Rolldown declaration bundling in parallel, using the same bundler configuration as production. Declaration bundling consumes the existing `lib/src/**/*.d.ts` files with `dtsInput: true`; TypeScript remains responsible for semantic checking and declaration generation. The build also preserves the unbundled declarations under `dist/src`.

Modern Rolldown bundles use its built-in Oxc transformer with an ES2015 syntax ceiling and the existing minimum browser versions. Babel remains for `array.full.es5.js` (Oxc cannot emit ES5) and the three slim/extension entries: replacing their transformer currently loses source-map names required by the private-property ABI check. TestCafe also still uses Babel. Terser remains the minifier for every runtime bundle.

To test watch mode on Linux or macOS, run `pnpm turbo --filter=posthog-js build` followed by `pnpm test:dev-watch` from the repository root. The test temporarily edits browser and record entry points, verifies runtime and declaration rebuilds, then restores the source files and stops the watchers. Run it in an idle checkout without other builds or watchers. CI runs it after the unit tests.

### Private-property ABI and declarations

Production property mangling is a cross-bundle contract, not just a size optimization. `module.slim.js` and `extension-bundles.js` share Terser's property-name cache; `module.slim.no-external.js` preserves property names, so properties exchanged across that boundary must be reserved. Preserve the ABI and overlap classifications in `terser-cross-bundle-properties.cjs` and the reserved names in `rollup.config.mjs`. The postbuild checker, `scripts/check-mangled-property-consistency.js`, derives original private-property names from source maps: changing transformers or dropping map names can invalidate the check even when bundles execute.

Keep TypeScript semantic checking and declaration generation; Rolldown bundles the emitted declarations rather than replacing those checks. Preserve canonical PostHog type references across entrypoints (classes with private fields are nominally typed), required inlined upstream types, and the published unbundled `dist/src` declarations. The built-output tests in `src/__tests__/entrypoints/module.test.ts` cover these contracts.

Browser extension UI uses the configured Preact JSX runtime (`jsxImportSource: preact` in `tsconfig.json`), not the separate React bindings. React bindings are built separately: run `pnpm --filter=@posthog/react dev` from the repository root when working on them.

### Old-browser syntax and built-ins

IE11 is not in the supported-browser list, but `array.full.es5.js` still uses IE11-compatible Babel targets in `rollup.config.mjs`. CI's `.github/workflows/es-check.yml` validates ES5/ES6 bundle syntax. Syntax validation and down-level compilation do not establish runtime built-in availability: a missing prototype method can still throw in valid ES5 code.

The polyfill canary in `src/__tests__/entrypoints/module.test.ts` evaluates all four web-vitals bundles in a frame with the post-baseline built-ins they call removed, then checks that those built-ins were installed. Preserve it when updating dependencies or transforms; `es-check` alone cannot detect missing polyfills.

The IE11 BrowserStack job in `.github/workflows/testcafe.yml` also sets `BROWSERSLIST` to include IE11 for the Babel preset used by TestCafe's injected `ClientFunction` wrappers. Preserve those wrapper targets separately from the SDK bundle targets: otherwise modern wrapper syntax can make `posthog.init` hang silently.

## Testing

Use root Turbo commands to bootstrap prerequisites, for example `pnpm turbo run test:unit test:built --filter=posthog-js` from the repository root. The browser unit task requires browser, workspace-dependency, and React build outputs. Direct package commands assume these outputs exist; rebuild stale artifacts after source changes.

Run the following package commands from `packages/browser`:

- **Unit tests (Vitest):** `pnpm test:unit` runs the source suite, including built-output checks. In particular, `src/__tests__/entrypoints/module.test.ts` reads `dist` during collection; the full suite is not build-free. For iteration, select a focused source test with `pnpm exec vitest run src/path/to/test.test.ts` and check that it does not depend on built artifacts.
- **Functional tests:** `pnpm test:functional` exercises integration behavior with mocked APIs. `pnpm test` runs both unit and functional suites.
- **Playwright:** real-browser tests; for a focused noninteractive run use `pnpm exec playwright test path/to/test.spec.ts --reporter=line`. The default HTML reporter can wait after local failures. UI runs, such as `pnpm exec playwright test --ui --project webkit --project firefox`, are intentionally interactive.
- **TestCafe E2E:** high-level integration with a live PostHog instance and BrowserStack; see the setup below.

Focused runs do not replace the root [CI-aligned checks](../../CONTRIBUTING.md#ci-aligned-checks). Select relevant compatibility, build/watch, declaration, packaging, and live-browser checks when changing those contracts.

### Comparing `array.js` bundle size

Run `pnpm bundle-size:array` from the repository root for a fast comparison of the current working tree against `origin/main`. Pass another git ref to change the baseline:

```bash
pnpm bundle-size:array main
```

The script bundles both versions with the same esbuild settings and reports minified, gzip, and Brotli changes. It is intended for quick percentage comparisons; the production Rolldown build will have different absolute sizes.

### Running TestCafe E2E tests with BrowserStack

Testing on IE11 requires a bit more setup. TestCafe tests use the playground application to test the locally built `array.full.js` bundle. They also verify that the events emitted during the testing of playground are loaded into the PostHog app. By default this uses `https://us.i.posthog.com` and the project with ID `11213`. See the TestCafe tests to override these if needed. PostHog internal users can ask `@benjackwhite` or `@hazzadous` for access. You will need to set `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_API_KEY`.

You'll also need a [BrowserStack](https://www.browserstack.com/) account. If you are using CodeSpaces, these variables will already be available in your shell environment.

After all this, run:

1. Optional: rebuild browser bundles on changes: `pnpm dev`.
2. Export BrowserStack credentials: `export BROWSERSTACK_USERNAME=xxx BROWSERSTACK_ACCESS_KEY=xxx`.
3. Run tests: `npx testcafe "browserstack:ie" testcafe/e2e.spec.js`.

### Running the local Next.js playground

Use `playground/nextjs` (from the repository root) to test `posthog-js` as an npm module in a Next.js application. Its initialization in `playground/nextjs/src/posthog.ts` reads `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`.

1. Run `posthog` locally on port `8000` (`DEBUG=1 TEST=1 ./bin/start`).
2. Run `python manage.py setup_dev --no-data` on the `posthog` repo to set up a demo account.
3. Copy the project API key from `http://localhost:8000/project/settings` for the last step.
4. From this repository's root, run `pnpm build` followed by `pnpm package` to generate the local SDK tarballs used by the playground.
5. From the repository root, run `cd playground/nextjs`.
6. Run `pnpm install` to install dependencies.
7. Run `NEXT_PUBLIC_POSTHOG_KEY='<your-local-api-key>' NEXT_PUBLIC_POSTHOG_HOST='http://localhost:8000' pnpm dev` to start the application.

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

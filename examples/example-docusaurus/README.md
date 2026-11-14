# Docusaurus example

Tests the installed `posthog-docusaurus` tarball against Docusaurus **3.10.2** and React **19.3.1**.

## Setup

Use Node.js 24 and the repository's pnpm version. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm turbo run build --filter=posthog-js
pnpm package --filter=posthog-docusaurus
cd examples/example-docusaurus
pnpm install
```

The shared pnpm hook installs `posthog-docusaurus` from `target/posthog-docusaurus.tgz`. After changing the plugin, repack it, remove this example's `node_modules`, and run `pnpm install` again so pnpm replaces the cached local tarball. The example is an independent workspace with the same seven-day dependency cooldown as the monorepo.

## Run the compatibility checks

Install Brave Browser at its standard macOS path or as `brave-browser` on Linux, or set `BRAVE_EXECUTABLE` to its executable. Then run:

```sh
pnpm test
```

The test builds the site, launches a separate headless Brave process with a temporary profile, and checks:

- The installed plugin matches the current built artifact.
- Production static rendering, hydration, SDK initialization, and configuration forwarding.
- Exactly one initial pageview.
- Custom events and button autocapture delivered to ingestion.
- Client-side navigation without a document reload, with exactly one pageview containing the destination URL.
- Analytics disabled by default in development.
- Analytics enabled explicitly in development.
- Default pageleave capture on unload.
- The landing pageview after opt-in, without navigation.

SDK assets come from `packages/browser/dist`, built during setup. Configuration, feature flag responses, and ingestion are mocked locally; all non-local browser requests are blocked. No real project key is used and no events are sent to PostHog. Session replay and surveys are disabled and are not verified. The [Library checks workflow](../../.github/workflows/library-ci.yml) runs these credential-free checks.

The SDK captures the initial pageview. The plugin's route hook skips the initial load and captures subsequent pathname changes, preserving SDK defaults for pageleave and consent behavior.

## Run the site manually

```sh
pnpm start
```

Development analytics are disabled by default. To try a production build with your own project, replace the dummy API key in `docusaurus.config.js`, then run:

```sh
pnpm build
pnpm serve
```

## Optional live Cloud report

`POSTHOG_API_KEY=... POSTHOG_API_HOST=... pnpm test:cloud` sends synthetic events to the explicitly configured project using the installed plugin and the CDN SDK. Run only with permission to send events to that project. It writes a diagnostic report to a temporary file, or to `POSTHOG_E2E_REPORT`, and does not run in CI. Unlike the compatibility suite, this script records outcomes for inspection rather than asserting scenario results; a zero exit status does not establish successful ingestion.

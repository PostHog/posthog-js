# Higher-assurance browser installation

This recipe reduces runtime executable dependencies when you trust a reviewed SDK release but do not want later vendor/CDN responses to supply new JavaScript. It uses existing SDK options, not a security preset or a sandbox. It does **not** make an untrusted SDK safe, prevent all malicious configuration effects, or replace your application's security and privacy review.

## 1. Pin and bundle reviewed code

Install an exact version you have reviewed, without `^`, `~`, or `latest`. For example, to reproduce this guide's SDK baseline:

```sh
npm install --save-exact posthog-js@1.442.1
```

This is a reproducibility example, not a recommendation to stay on that release indefinitely. Review security updates and upgrade deliberately. Commit `package.json` **and** `package-lock.json`, and use `npm ci` in CI/deployment. With pnpm or Yarn, use an exact dependency, commit that manager's lockfile, and enforce its frozen/immutable install mode. Lockfiles also pin transitive dependencies; an exact top-level SDK version alone does not.

Bundle the SDK into your own application build, served through your controlled deployment. Do not also install the CDN snippet, static loader, tag-manager integration, or another default SDK instance on the page.

| Import                        | What ships locally                                                                                               | Trade-off                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `posthog-js/no-external`      | Core and extension controllers, without registering the external script loader                                   | Features needing separate executable bundles are unavailable unless explicitly bundled by you.                                                                          |
| `posthog-js/full/no-external` | Also bundles replay, survey rendering, logs, exception autocapture, tracing headers, web vitals, and dead clicks | Larger application artifact; bundled features still need local policy and privacy review. Product tours, conversations, toolbar, and chat integrations are not bundled. |

Neither entrypoint erases a loader or renderer already registered globally by another bundle. Use **both** the no-external distribution and the runtime restriction below.

## 2. Apply local policy at the first initialization

```ts
import posthog from 'posthog-js/no-external'
// Alternatively: import posthog from 'posthog-js/full/no-external'

posthog.init('phc_YOUR_PUBLIC_PROJECT_TOKEN', {
    api_host: '/ingest', // Requires your reverse proxy; see below.
    disable_external_dependency_loading: true,
    opt_in_site_apps: false,
    disable_web_experiments: true,
    disable_surveys: true,

    // Conservative optional restrictions on remote UI and recording:
    disable_product_tours: true,
    disable_conversations: true,
    disable_session_recording: true,
})

posthog.onFeatureFlags(() => {
    const variant = posthog.getFeatureFlag('checkout-layout')
    // Use reviewed application logic, not remote HTML/JavaScript.
})
posthog.capture('checkout opened', { source: 'application' })
```

Pass these settings **before** initialization can request dependencies. Do not initialize permissively and tighten policy later: that cannot retract executed code, and is not a reliable way to cancel already queued loads. Keep the restrictions on every named instance and every independently initialized copy. Avoid mixed installations; one permissive instance can execute code with the privileges of the whole page, regardless of another instance's policy. A previously registered global renderer may still run locally even when new script loading is disabled.

- `disable_external_dependency_loading: true` blocks the standard SDK script loader, including executable `config.js`, even if another bundle registered that loader. On a fresh installation without preloaded configuration, project configuration instead uses JSON `GET /array/<public-project-token>/config`; evaluated flags use `/flags/`. Do not disable remote configuration or feature flags to achieve this recipe. Preloaded global configuration, if present, is still consumed: avoid token-specific scripts and review all page bootstrap code.
- `opt_in_site_apps: false` prevents site-app activation. This option **alone** does not prevent `config.js` from executing in a normal loader-enabled installation.
- `disable_web_experiments: true` and `disable_surveys: true` remove remote HTML-driven UI paths. Disabling external scripts does **not** sanitize HTML supplied in JSON; this matters even with the full/no-external bundle's locally available renderer. Do not invoke preview APIs or custom renderers with untrusted content. `disable_surveys_automatic_display` is not a substitute for disabling surveys.
- The optional product-tour and conversation settings reduce other remotely controlled UI; they are not an assertion that those renderers have equivalent HTML vulnerabilities. Keep them for the most conservative setup.
- Keep recording disabled if you do not need it. If replay is required, evaluate `full/no-external`, its capture/masking/consent settings, and the resulting traffic before removing `disable_session_recording`. Do not remove the external-loading restriction to recover missing features. The same review applies to other bundled optional features.

Ordinary event capture, autocapture/pageviews (unless separately disabled), JSON configuration, and feature-flag evaluation remain available. Flags and payloads are still remote input: do not evaluate them as code or insert them as unsanitized HTML. Client-side flags are not authorization checks. Remote configuration can still affect supported capture behavior; constrain collection with the SDK's privacy settings and `before_send` as appropriate.

`/ingest` is an example customer-managed reverse-proxy prefix, **not** an SDK-provided endpoint. Route event ingestion (`/ingest/e/`), flags (`/ingest/flags/`), and JSON project configuration (`/ingest/array/<token>/config`) to the appropriate PostHog regional services. Validate any other endpoints your selected features require. Alternatively use `https://us.i.posthog.com` or `https://eu.i.posthog.com`; for these Cloud hosts the SDK resolves JSON configuration to the corresponding `us-assets` or `eu-assets` host. Never put personal API keys in browser code.

## 3. Keep the security boundaries distinct

| Control                                                         | What it does                                                                                                   | What it does not do                                                                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Exact npm pin + committed lockfile                              | Reproduces reviewed dependency resolution; lockfile integrity checks downloaded package bytes                  | Establish that a release is benign, or protect you after accepting a malicious npm upgrade or compromised build tool |
| Locally bundled code + disabled external loading                | Removes the standard SDK's runtime executable downloads                                                        | Contain code already on the page, sanitize remote HTML, or prevent ordinary data/configuration traffic               |
| Exact/versioned script URLs or `strict_script_versioning: true` | Selects a release path; strict `true` avoids legacy-path fallback                                              | Authenticate the bytes served at that path; `config.js` is not made immutable by this option                         |
| Subresource Integrity (SRI)                                     | Browser-checks the bytes of the particular script/style carrying a trusted expected hash                       | Transitively protect descendants: hashing a loader does **not** hash its injected core or feature scripts            |
| Reverse proxy / `api_host` / `asset_host`                       | Changes routing and which infrastructure serves requests                                                       | Verify vendor content or reduce JavaScript's page privileges; proxying a mutable script keeps it mutable             |
| Content Security Policy (CSP)                                   | Limits permitted resource origins, inline execution and other browser capabilities                             | Make an allowed script origin trustworthy or fully contain an already authorized malicious script                    |
| Isolation                                                       | A separate origin and carefully sandboxed iframe can limit privileges if designed and tested for your use case | Shadow DOM is **not** a script security boundary; this installation does not isolate the SDK from your page          |
| Consent and privacy settings                                    | Control permitted capture and storage behavior                                                                 | Verify code integrity or guarantee that initialization makes no network requests                                     |

If separately approving executable assets, obtain expected hashes through your own reviewed deployment, not dynamically from the same potentially compromised response. Each executed asset needs its own applicable integrity policy. This guide does not depend on loader-integrity support or promise complete integrity coverage from a script-preparation hook.

Deploy a restrictive CSP as defense in depth. Authorize your application bundles with your normal nonce/hash policy; avoid permitting vendor script origins or `unsafe-inline`/`unsafe-eval` just for this recipe. Allow the required JSON/flags/capture destinations in `connect-src` (with the proxy example, normally `'self'`). Review styles, images, workers, and other directives for the bundled features you actually use. A nonce or `strict-dynamic` delegation is not content verification. Test the policy in your application: CSP, the browser, and your bundler are separate controls.

Where consent is required before any SDK activity, defer importing/initializing the SDK until consent. `opt_out_capturing_by_default: true` can gate capture when initializing earlier, but is not a blanket no-network or no-download guarantee. Review persistence settings separately.

A malicious approved npm release, compromised application build, browser extension, or another script with page privileges can read page data and bypass these SDK settings. Audit upgrades, dependency changes, build access and deployment artifacts accordingly.

## 4. Verify your deployment

With a clean browser profile, exercise initialization, flags, capture, and optional features while inspecting network and DOM activity. Expect JSON configuration and normal ingestion, but no dynamically inserted vendor scripts (including `config.js`, recorder, survey, or toolbar scripts). Repeat after upgrades, consent changes, and route transitions. Test without CSP first so CSP rejection cannot hide an unwanted script request, then test with your deployed CSP. Check for duplicate SDKs/tag-manager integrations.

The regression fixture in [`playwright/mocked/high-assurance-installation.spec.ts`](playwright/mocked/high-assurance-installation.spec.ts) tests the built no-external and full/no-external modules, with and without a default bundle registering a shared global loader. It uses locally intercepted responses to enable remote features while asserting JSON configuration, flag results, capture delivery, and no additional executable requests. This is focused regression coverage, not proof of safety against arbitrary hostile responses or a compromised SDK.

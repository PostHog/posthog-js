# @posthog/browser agent guide

Follow [Bundle architecture](./ARCHITECTURE.md) for behavioral constraints, package boundaries, tree-shaking rules, and bundle review. Follow [`posthog-browser-v2-minimal-bundle-plan.md`](../../posthog-browser-v2-minimal-bundle-plan.md) for the parity gate and implementation order.

Core behavior is a fixed constraint. Bundle size is the optimization objective. Do not remove wire, consent, bot-filter, identity, session, cross-context, delivery, no-throw, or extension-isolation behavior to meet a byte target.

Use the `@posthog/browser-common` `Client` and `Extension` contracts. Do not add a second extension contract.

Keep package import free of storage, DOM, timer, network, and global-registration work. Do not import `posthog-js`, `core-js`, `fflate`, Preact, DOMPurify, rrweb, web-vitals, or any `@posthog/core` runtime module from the root graph. Use exact runtime subpaths and type-only contract imports.

Keep the capture pipeline fixed and direct. Use Capture Analytics V1 at `POST /i/v1/analytics/events`; do not use the legacy `/e/` envelope. Use a small lane dispatcher so each traffic class owns its queue, endpoint, wire shape, payload limits, transport, and retry policy. The root statically includes only the analytics lane. Select optional lanes through explicit product APIs such as `captureAi()`, not event-name prefixes or a public lane argument on general `capture()`. Do not add a generic middleware or dependency-injection framework.

Protect each core behavior with parity, Capture V1 compliance, conformance, or fault-injection tests. Run `pnpm test:browser` after changing consent, session, window, or native storage behavior; it verifies cross-tab revocation, session adoption, reload, and copied-tab behavior in Chromium, Firefox, and WebKit. Run `pnpm bundle-size` after each runtime change and inspect module attribution when the graph changes.

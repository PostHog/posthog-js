# @posthog/browser agent guide

Keep the root entrypoint small. Measure runtime imports with `pnpm bundle-size`.

Use the `@posthog/browser-common` `Client` and `Extension` contracts. Do not add a second extension contract.

Do not import `posthog-js`, `core-js`, `fflate`, Preact, DOMPurify, rrweb, or web-vitals from the root graph.

Keep package import free of storage, DOM, timer, and network work. Start external work only from `createPostHog` or a method call.

Use exact subpath imports for shared browser utilities. Use type-only imports for contracts and types.

Prefer a fixed capture pipeline and direct code. Do not add a generic middleware or dependency-injection framework.

# PostHog Nuxt package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [Nuxt library docs](https://posthog.com/docs/libraries/nuxt-js)

## Server request context

Set `posthogConfig.serverConfig.requestContext` to `true` to add incoming
`X-PostHog-Distinct-ID` and `X-PostHog-Session-ID` values to the server request
context. The default is `false`. These headers are untrusted analytics context.
Never use them for authentication or authorization. Existing application context,
including its properties, takes precedence. Blank or absent IDs are omitted.

For application-owned OpenTelemetry spans, use the optional
`PostHogContextSpanProcessor` from `posthog-node/otel` with the existing server
client returned by `getPostHogServerClient()` from `@posthog/nuxt/server`.
The accessor returns `undefined` before the module's Nitro plugin starts and
after that client closes. Initialize the application's tracing setup after the
PostHog Nitro plugin and before requests start. Keep the application's existing
provider, exporters, processors, and sampler. This module does not create spans
or install OpenTelemetry. The Node SDK must include the shared context span
bridge before this integration is released.

The wrapper covers Nitro 2's H3 request handler and Nitro 3's fetch handler.
It adds context to an existing recording request span and to child spans started
inside the handler when the shared processor is installed. Work that the handler
starts, including detached background tasks, keeps the request context after the
handler returns or throws.
An error reported through Nitro's error hook uses the active application context
first, then the saved request context. Errors without either keep the existing
anonymous identity.
The server accessor is available only through its Node export.

## Questions?

### [Check out our community page.](https://posthog.com/posts)

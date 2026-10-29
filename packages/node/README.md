# PostHog Node.js package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [Node.js library docs](https://posthog.com/docs/libraries/node)

## OpenTelemetry request context

The optional `posthog-node/otel` entrypoint exports `PostHogContextSpanProcessor`.
Pass your PostHog client to its constructor and add the processor to the application's OpenTelemetry provider.
Install the optional `@opentelemetry/api` peer dependency and keep the application's provider, exporter, sampling, and other processors.
Configure OpenTelemetry before the application accepts requests, and install `setupExpressRequestContext` before Express routes.

The processor adds available `sessionId` and `posthogDistinctId` attributes to recording OpenTelemetry SDK spans.
Disabled or opted-out clients add no PostHog attributes. Existing span attributes keep their values.
It also updates an active request span when PostHog reads the request context.
`enrichCurrentSpan` is also available from the main `posthog-node` entry without loading OpenTelemetry. It is a no-op until a processor is registered.
Explicit request entry also fills missing IDs on the nearest recording server ancestor, following parent span objects observed by the processor.
Parent links use weak references, so a retained child does not keep ended ancestors alive.
If the sampler drops an intermediate span or garbage collection removes it, that parent chain cannot be verified and the earlier server span stays unchanged.
Ordinary context entry keeps its current-span behavior and does not walk to server ancestors.
It preserves explicit span attributes and reads values once, so exported spans keep their original context.
It recognizes `sessionId` and `posthogDistinctId`; `user.id` alone does not override header-derived analytics identity.
API-only spans without public readable attributes are skipped.
For a manual request integration, call `enrichCurrentSpan(posthog)` from `posthog-node/otel` after entering the header context.
This fills missing attributes on an incoming span that already has application context.
The helper does nothing when no context processor is installed.
For other Node.js frameworks, pass `{ signal: controller.signal }` to `withContext` or `enterContext` and abort the controller when the request ends.
This ends the context for detached work, including inherited nested scopes, without cancelling the handler.
The signal also works without OpenTelemetry. Calls without a signal keep their existing scope behavior.
`fresh: true` starts an independent context with only the supplied values and its own optional signal.
A background job can use it with explicit IDs before or after the request ends.
Without `fresh: true`, nested scopes inherit the parent lifetime as well as their own signal.
Express preserves an existing application identity and treats incoming headers as fallback analytics context.
The headers must not be used for authentication or authorization.

Express context stays active through async request work, including promises and timers that continue after the response ends.
Exceptions keep the context they were captured in while asynchronous error processing finishes.
Use explicit context for a background job that needs its own IDs.
The Node.js `PostHogInterceptor` from `posthog-node/nestjs` also enriches request and child spans.
It keeps its existing fresh header context, with the same lifetime as Express.
Explicit `sessionId` and `posthogDistinctId` span attributes keep their values.
This integration does not create IDs, traces, recordings, or log exporters.
It does not change the application's OpenTelemetry setup or require OpenTelemetry for other SDK use.

## Questions??

### [Check out our community page.](https://posthog.com/posts)

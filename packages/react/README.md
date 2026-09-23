# PostHog React package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [React library docs](https://posthog.com/docs/libraries/react)

## Slim entry point

`@posthog/react/slim` publishes a `PostHogProvider` that takes a client you initialized. It does not import the `posthog-js` runtime, so it pairs with the tree-shakeable `posthog-js/slim` core. The default entry point of this package imports the full runtime instead.

See [Slim build](../browser/README.md#slim-build) for the browser side of the setup.

## Questions?

### [Check out our community page.](https://posthog.com/posts)

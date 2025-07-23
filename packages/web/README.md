# PostHog Web

> 🚧 This is a reduced feature set package. Currently the only officially supported feature complete way of using PostHog on the web is [posthog-js](https://github.com/PostHog/posthog-js)

This package is currently published to npm as [posthog-js-lite](https://www.npmjs.com/package/posthog-js-lite) and is a simplified version of the recommended and officially supported `posthog-js`.

You'd want to use this only if you're very conscious about package sizes, and this reduced feature set (only analytics and feature flags) works for your use case. The most common use case is in chrome extensions.

## Installation

```bash
npm i -s posthog-js-lite
# or
yarn add posthog-js-lite
```

It is entirely written in Typescript and has a minimal API as follows:

```ts
import PostHog from 'posthog-js-lite'

const posthog = new PostHog('my-api-key', {
  /* options, e.g. for self-hosted users */
  // host: "https://my-posthog.app.com"
})

// Capture generic events
posthog.capture('my-event', { myProperty: 'foo' })

// Identify a user (e.g. on login)
posthog.identify('my-unique-user-id', { email: 'example@posthog.com', name: 'Jane Doe' })
// ...or with Set Once additional properties
posthog.identify('my-unique-user-id', { $set: { email: 'example@posthog.com', name: 'Jane Doe' }, $set_once: { vip: true } })

// Reset a user (e.g. on logout)
posthog.reset()

// Register properties to be sent with all subsequent events
posthog.register({ itemsInBasket: 3 })
// ...or get rid of them if you don't want them anymore
posthog.unregister('itemsInBasket')

// Add the user to a group
posthog.group('organisations', 'org-1')
// ...or multiple groups at once
posthog.group({ organisations: 'org-1', project: 'project-1' })

// Simple feature flags
if (posthog.isFeatureEnabled('my-feature-flag')) {
  renderFlaggedFunctionality()
} else {
  renderDefaultFunctionality()
}

// Multivariate feature flags
if (posthog.getFeatureFlag('my-feature-flag-with-variants') === 'variant1') {
  renderVariant1()
} else if (posthog.getFeatureFlag('my-feature-flag-with-variants') === 'variant2') {
  renderVariant1()
} else if (posthog.getFeatureFlag('my-feature-flag-with-variants') === 'control') {
  renderControl()
}

// Override a feature flag for a specific user (e.g. for testing or user preference)
posthog.overrideFeatureFlag('my-feature-flag', true)

// Listen reactively to feature flag changes
posthog.onFeatureFlag('my-feature-flag', (value) => {
  respondToFeatureFlagChange(value)
})

// Opt users in or out, persisting across sessions (default is they are opted in)
posthog.optOut() // Will stop tracking
posthog.optIn() // Will start tracking
```

## History API Navigation Tracking

Single-page applications (SPAs) typically use the History API (`pushState`, `replaceState`) for navigation instead of full page loads. By default, PostHog only tracks the initial page load.

To automatically track navigation events in SPAs, enable the `captureHistoryEvents` option:

```ts
const posthog = new PostHog('my-api-key', {
  captureHistoryEvents: true
})
```

When enabled, PostHog will:
- Track calls to `history.pushState()` and `history.replaceState()`
- Track `popstate` events (browser back/forward navigation)
- Send these as `$pageview` events with the current URL and pathname
- Include the navigation type (`pushState`, `replaceState`, or `popstate`) as a property

This ensures accurate page tracking in modern web applications without requiring manual pageview capture calls.

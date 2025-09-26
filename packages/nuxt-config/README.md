# PostHog Nuxt module

- provides posthog client and auto exception capture for Vue,
- provides auto exception capture plugin for Nitro,
- handles sourcemap configuration and upload for the PostHog Error Tracking product.

Please see the main [PostHog Error Tracking docs](https://posthog.com/docs/error-tracking).

## Usage

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@ablaszkiewicz/posthog-nuxt'], // Add module reference here
  sourcemap: { client: 'hidden' }, // Make sure to set it (otherwise client sourcemaps will not be generated)
  posthog: {
    host: 'http://localhost:8010', // (optional) Host URL, defaults to https://us.posthog.com
    publicApiKey: 'phc_VXlGk6yOu3agIn0h7lTmSOECAGWCtJonUJDAN4CexlJ',
    sourceMaps: {
      enabled: true, // (optional) Enable sourcemaps generation and upload, default to true on production builds
      envId: '2', // (optionalEnvironment ID, see https://app.posthog.com/settings/environment#variables
      project: 'my-application', // (optional) Project name, defaults to repository name
      version: '1.0.0', // (optional) Release version, defaults to current git commit
      privateApiKey: 'phx_YZZHl8xzLkCWHSpVahmkggLGaS6gmSxCNmH26N0RUGZnqAs',
    },
  },
})
```

## FAQ

```
Q: I see typescript errors in the posthog config after adding module
A: It is possible that after adding new module to `modules`, typescript will complain about types. Solution is to remove `.nuxt` directory and regenerate it using `build` command you are using. This will properly regenerate config types.
```

## Questions?

### [Check out our community page.](https://posthog.com/posts)

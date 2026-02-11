# PostHog Nuxt module

- Handles sourcemap configuration and upload for the PostHog Error Tracking product
- Provides posthog client and auto exception capture for Vue and Nitro

Please see the main [PostHog Error tracking docs](https://posthog.com/docs/error-tracking).

## Usage

1. Install the package

```
pnpm add @posthog/nuxt
```

2. Configure posthog module

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@posthog/nuxt'], // Add module reference

  sourcemap: { client: 'hidden' }, // Make sure to set it (otherwise client sourcemaps will not be generated)

  nitro: {
    rollupConfig: {
      output: {
        sourcemapExcludeSources: false, // Make sure to set it (otherwise server sourcemaps will not be generated)
      },
    },
  },

  posthogConfig: {
    host: 'http://localhost:8010', // (optional) Host URL, defaults to https://us.posthog.com
    publicKey: 'public api key', // Your public web snippet key. You can find it in settings
    clientConfig?: Partial<PostHogConfig> // (optional) It will be passed to the posthog-js client on init in vue
    serverConfig?: PostHogOptions // (optional) It will be passed to the posthog-node client on init in nitro. Please note that this client instance is intended for error-tracking purposes only
    sourceMaps: {
      enabled: true, // Enables sourcemaps generation and upload
      projectId: '2', // Project ID, see https://app.posthog.com/settings/project#variables
      project: 'my-application', // (optional) Project name, defaults to git repository name
      version: '1.0.0', // (optional) Release version, defaults to current git commit
      personalApiKey: 'personal api key', // Your personal API key. You can generate it in settings -> Personal API keys
    },
  },
})
```

3. You can access your vue posthog client inside vue using

```ts
// some-file.vue
const { $posthog } = useNuxtApp()
```

## Composables

The module provides auto-imported composables for working with feature flags:

### `usePostHog()`

Returns the PostHog client instance.

```vue
<script setup>
const posthog = usePostHog()

posthog.capture('event_name')
</script>
```

### `useFeatureFlagEnabled(flag: string)`

Returns a reactive ref that checks if a feature flag is enabled (returns `true`/`false`/`undefined`).

```vue
<script setup>
const isEnabled = useFeatureFlagEnabled('my-flag')
</script>

<template>
  <div v-if="isEnabled">Feature is enabled!</div>
</template>
```

### `useFeatureFlagVariantKey(flag: string)`

Returns a reactive ref containing the feature flag value/variant (returns the variant string, `true`/`false`, or `undefined`).

```vue
<script setup>
const variant = useFeatureFlagVariantKey('my-flag')
</script>

<template>
  <div v-if="variant === 'variant-a'">Show variant A</div>
  <div v-else-if="variant === 'variant-b'">Show variant B</div>
</template>
```

### `useFeatureFlagPayload(flag: string)`

Returns a reactive ref containing the feature flag payload (returns any JSON value or `undefined`).

```vue
<script setup>
const payload = useFeatureFlagPayload('config-flag')
</script>

<template>
  <div v-if="payload">Config value: {{ payload.value }}</div>
</template>
```

All these composables automatically update when feature flags are loaded or changed.

4. On the server side, the PostHog client instance initialized by the plugin is intended exclusively for error tracking. If you require additional PostHog client functionality for other purposes, please instantiate a separate client within your application as needed.

## FAQ

```
Q: I see typescript errors in the posthog config after adding this module
A: It is possible that after adding a new module to `modules` typescript will complain about types. Solution is to remove `.nuxt` directory and regenerate it by running `build` command you are using. This will properly regenerate config types.
```

```
Q: I see stack traces but I do not see line context in the error tracking tab
A: Double check whether you enabled sourcemaps generation in the nuxt config both for vue and nitro. It is covered in the docs.
```

## Developing this module

1. Navigate into module directory
2. Install dependencies using `pnpm i`
3. Build the module using `pnpm build`
4. Navigate into playground directory
5. Install dependencies using `npm i`
6. Build the playground using `npm run build`
7. Run the playground using `node .output/server/index.mjs`

## Questions?

### [Check out our community page.](https://posthog.com/posts)

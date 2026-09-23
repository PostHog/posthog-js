# PostHog JavaScript package

[![npm package](https://img.shields.io/npm/v/posthog-js?style=flat-square)](https://www.npmjs.com/package/posthog-js)
[![MIT License](https://img.shields.io/badge/License-MIT-red.svg?style=flat-square)](https://opensource.org/licenses/MIT)

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [JavaScript library docs](https://posthog.com/docs/libraries/js)

## Bundle variants

The package publishes one API through several bundles. Each bundle has its own import path.

| Import path | What it contains |
| --- | --- |
| `posthog-js` | The default build. It loads session replay, surveys and the other extensions from the CDN when your project uses them. |
| `posthog-js/full` | The same build with those extensions inlined. It keeps the external script loader for what it does not inline. |
| `posthog-js/no-external` | The default build without the external script loader. |
| `posthog-js/full/no-external` | Inlined extensions and no external script loader. Desktop apps, browser extensions and strict CSP sites need this one. |
| `posthog-js/slim` | The tree-shakeable core. It contains no extension. You pass the extensions your site uses. |
| `posthog-js/slim/no-external` | The slim core without the external script loader. |
| `posthog-js/extensions` | The extension bundles that the slim core composes with. |

The slim core and the extension bundles are ES modules only, because a bundler must tree-shake them. The other paths also ship a CommonJS build for `require`.

## Slim build

Use the slim build when the SDK is on the critical rendering path. The core carries no extension, so your bundler keeps out every extension you do not pass. Measured with esbuild on version 1.434.11, an app bundle with the default build is about 99 KB after minification and gzip, and about 50 KB with the slim core alone. Each extension you add moves the number back up.

Pass the extension bundles your site uses through `__extensionClasses`:

```ts
import posthog from 'posthog-js/slim'
import { AnalyticsExtensions, SessionReplayExtensions } from 'posthog-js/extensions'

posthog.init('<ph_project_api_key>', {
    api_host: '<ph_client_api_host>',
    __extensionClasses: { ...AnalyticsExtensions, ...SessionReplayExtensions },
})
```

`posthog-js/extensions` groups the extensions by feature: `AnalyticsExtensions` (autocapture, heatmaps, dead clicks and web vitals), `SessionReplayExtensions`, `FeatureFlagsExtensions`, `ErrorTrackingExtensions`, `SurveysExtensions`, `ProductToursExtensions`, `ExperimentsExtensions`, `ConversationsExtensions`, `LogsExtensions`, `MetricsExtensions`, `TracingExtensions`, `SiteAppsExtensions`, `ToolbarExtensions`, and `AllExtensions` for all of them.

An extension you do not pass is absent at runtime, and the slim declarations say so: `posthog.featureFlags` has the type `PostHogFeatureFlags | undefined`, so TypeScript asks you to check it before use. This is the one API difference from the other bundles.

### Slim build with React

`@posthog/react/slim` publishes a `PostHogProvider` that takes a client you initialized. The default `@posthog/react` entry point imports the full `posthog-js` runtime, which cancels the size win.

```tsx
import posthog from 'posthog-js/slim'
import { AnalyticsExtensions } from 'posthog-js/extensions'
import type { PostHog } from 'posthog-js'
import { PostHogProvider } from '@posthog/react/slim'
import type { ReactNode } from 'react'

posthog.init('<ph_project_api_key>', {
    api_host: '<ph_client_api_host>',
    __extensionClasses: { ...AnalyticsExtensions },
})

export const Providers = ({ children }: { children: ReactNode }) => (
    <PostHogProvider client={posthog as unknown as PostHog}>{children}</PostHogProvider>
)
```

The client works as it is at runtime. The cast covers a TypeScript limitation: the slim bundle publishes its own `PostHog` declaration, which TypeScript treats as a different type from the canonical one.

## Surveys and capture

Built-in surveys stay hidden while event capture is disabled, including before consent when `opt_out_capturing_by_default` is enabled. This applies to automatic display, `displaySurvey()` (including `ignoreConditions`), and `renderSurvey()`. Delayed surveys recheck capture before appearing.

`canRenderSurvey()` and `canRenderSurveyAsync()` return a disabled reason in this state. Custom integrations can still discover surveys through `getActiveMatchingSurveys()`.

If capture stops while a survey is open, submitting keeps the answers in the form and shows an error. It does not mark the survey complete or clear its saved progress. The person can retry after capture is enabled again.

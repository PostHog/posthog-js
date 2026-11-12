# Getting started

The React Native SDK runs in iOS and Android apps, including Expo apps.

To send your first event, install `posthog-react-native` and the peer dependencies for Expo or the React Native CLI. [Install peer dependencies](#install-peer-dependencies) lists them.

Then wrap your app in `PostHogProvider` with your project token and host from your [project settings](https://app.posthog.com/project/settings), and call `capture` on the client that `usePostHog` returns.

## Install

```bash
npm install posthog-react-native
```

## Initialize

Wrap your app in `PostHogProvider`.

```tsx
import { PostHogProvider } from 'posthog-react-native'

export default function App() {
  return (
    <PostHogProvider apiKey="<ph_project_api_key>" options={{ host: 'https://us.i.posthog.com' }}>
      <YourApp />
    </PostHogProvider>
  )
}
```

## Capture an event

```tsx
import { usePostHog } from 'posthog-react-native'

const posthog = usePostHog()
posthog.capture('signed_up', { plan: 'pro' })
```

The second argument is an optional [properties](https://posthog.com/docs/data/events#event-properties) object.

> **Tip.** Name events in an `[object] [verb]` format, where `[object]` is the entity the behavior relates to and `[verb]` is the behavior. For example, `project created`, `user signed up`, or `invite sent`.

## Identify a user

```tsx
posthog.identify('user_123', { email: 'user@example.com' })
```

Call `identify` as soon as you can, typically right after your user logs in. PostHog then links the [anonymous events](https://posthog.com/docs/data/anonymous-vs-identified-events) captured before the call to that user. Read [identifying users](https://posthog.com/docs/product-analytics/identify) before you use it.

## Install with the wizard

Run this command in your project directory to add PostHog to your React Native project. The wizard detects your framework, installs the SDK, and sets up your first events.

```bash
npx -y @posthog/wizard@latest
```

## Install peer dependencies

`posthog-react-native` needs peer dependencies for storage, app details, device details, and localization. For apps built with Expo, there are no mobile native dependencies outside of supported Expo packages.

For Expo apps:

```bash
npx expo install posthog-react-native@4 expo-file-system expo-application expo-device expo-localization
```

For React Native apps:

```bash
yarn add posthog-react-native@4 @react-native-async-storage/async-storage react-native-device-info react-native-localize
# or
npm i -s posthog-react-native@4 @react-native-async-storage/async-storage react-native-device-info react-native-localize
```

For [React Native Web](https://github.com/necolas/react-native-web) or [React Native macOS](https://github.com/microsoft/react-native-macos), don't use the [expo-file-system](https://github.com/expo/expo/tree/master/packages/expo-file-system) package, because it doesn't support the Web and macOS targets. Use the [@react-native-async-storage/async-storage](https://github.com/react-native-async-storage/async-storage) package instead.

## Choose iOS dependencies

The optional `@posthog/react-native-plugin` package adds native features such as session replay and native crash capture. Install it as described in the guide for the feature that you use. Then choose one iOS dependency path.

> **CocoaPods is becoming read-only.** [CocoaPods has announced](https://blog.cocoapods.org/CocoaPods-Specs-Repo/) the following schedule for its public specs repository:
>
> - November 2 to 6, 2026: A read-only dry run will prevent us from publishing new PostHog iOS SDK versions to CocoaPods.
> - December 2, 2026 onward: The repository will be permanently read-only. New PostHog iOS SDK versions will only be available through Swift Package Manager (SPM).
>
> Existing iOS SDK versions will remain available through CocoaPods. To keep receiving iOS SDK updates, migrate the native plugin's `posthog-ios` dependency to SPM using the [hybrid CocoaPods and SPM setup](#cocoapods-with-posthog-ios-through-swift-package-manager), or use [full SPM integration](#full-swift-package-manager) if your app supports it. The hybrid path keeps CocoaPods for the plugin and other React Native dependencies.
>
> This change does not affect `@posthog/react-native-plugin` releases on npm or Android.

| Path                        | Resolves the plugin   | Resolves `posthog-ios` |
| --------------------------- | --------------------- | ---------------------- |
| CocoaPods                   | CocoaPods             | CocoaPods              |
| CocoaPods with SPM (hybrid) | CocoaPods             | Swift Package Manager  |
| Full Swift Package Manager  | Swift Package Manager | Swift Package Manager  |

- **CocoaPods.** Needs a React Native project that uses CocoaPods. This remains the default path.
- **CocoaPods with SPM (hybrid).** Needs React Native 0.75 or later and a CocoaPods project with dynamic frameworks.
- **Full Swift Package Manager.** Needs `@posthog/react-native-plugin` 2.4.0 or later, Xcode 16 or later, and an iOS 15.1 or later app deployment target. It uses React Native's experimental Swift Package Manager integration and doesn't use CocoaPods. It's verified with an iOS-only React Native 0.87.1 app and React Native Community CLI 20.2.0.

This verification doesn't cover Expo or other React Native versions. Use CocoaPods or the hybrid path unless you validate the full Swift Package Manager path for your configuration.

### CocoaPods

Use the standard React Native CocoaPods flow:

```bash
cd ios
pod install
```

The plugin podspec adds `posthog-ios` as a CocoaPods dependency. You don't need to add `posthog-ios` separately.

### CocoaPods with `posthog-ios` through Swift Package Manager

Add the following property to `ios/Podfile.properties.json`:

```json
{
  "posthog.useSpm": "true"
}
```

Add dynamic frameworks to your `ios/Podfile`:

```ruby
use_frameworks! :linkage => :dynamic
```

Then install the pods:

```bash
cd ios
pod install
```

This setting changes only how the plugin resolves `posthog-ios`. The plugin and other React Native dependencies still use CocoaPods.

### Full Swift Package Manager

This path uses React Native's experimental CocoaPods-free iOS integration. Every native dependency in your app must support React Native's full Swift Package Manager integration. Use CocoaPods or the hybrid path if a dependency doesn't support it.

Install your JavaScript dependencies first. Make a clean commit or a backup of your iOS project before the conversion. Then run this command from the `ios` directory:

```bash
npx react-native spm add --deintegrate --yes
```

The `--deintegrate` option removes the complete CocoaPods integration from the iOS project. React Native then finds the plugin's `ios/Package.swift` manifest. Swift Package Manager resolves the plugin and `posthog-ios`. Don't run `pod install` for this path.

PostHog CI verifies this path with the configuration listed above. The verified app sets its deployment target to iOS 15.1. The plugin package manifest has a separate iOS 15 minimum. The CocoaPods and hybrid paths keep the plugin podspec's iOS 13 minimum.

## Plan your setup

- **Set up a reverse proxy (recommended).** A [reverse proxy](https://posthog.com/docs/advanced/proxy) makes events less likely to be intercepted by tracking blockers. PostHog's [managed reverse proxy](https://posthog.com/docs/advanced/proxy/managed-reverse-proxy) is free for all PostHog Cloud users and routes through PostHog's infrastructure. You can also create your own with [Cloudflare](https://posthog.com/docs/advanced/proxy/cloudflare), [AWS CloudFront](https://posthog.com/docs/advanced/proxy/cloudfront), or [Vercel](https://posthog.com/docs/advanced/proxy/vercel).
- **Group products in one project (recommended).** If you have multiple customer-facing products, such as a marketing website, a mobile app, and a web app, install PostHog on them all and [group them in one project](https://posthog.com/docs/settings/projects). You can then track users across their entire journey and across platforms.

## Check option versions

The `PostHogOptions` entry in this reference lists every configuration option, its type, and its default. Some options need a minimum `posthog-react-native` version.

| Option                                 | Minimum version |
| -------------------------------------- | --------------- |
| `evaluationEnvironments`               | 4.10.0          |
| `evaluationContexts`                   | 4.21.0          |
| `disableRemoteFeatureFlags`            | 4.49.0          |
| `capturePushNotificationSubscriptions` | 4.62.0          |
| `capturePushNotificationOpened`        | 4.62.0          |
| `pushIdentityProvider`                 | 4.62.0          |

`evaluationEnvironments` is the legacy name for `evaluationContexts`. The SDK still supports it for backward compatibility. See [evaluation contexts](https://posthog.com/docs/feature-flags/evaluation-contexts).

`captureAppLifecycleEvents` is enabled by default since 4.39.0.

The three push options need `@posthog/react-native-plugin`.

`host` is optional if you use `https://us.i.posthog.com`. `addTracingHeaders` takes hostnames only, without the protocol or path, and matches them exactly.

## Use autocapture

PostHog autocapture can track the following events for you:

- **Application Opened.** The app is opened from a closed state.
- **Application Became Active.** The app comes to the foreground, for example from the app switcher.
- **Application Backgrounded.** The user sends the app to the background.
- **Application Installed.** The app is installed.
- **Application Updated.** The app is updated.
- **$screen.** The user navigates. See [Capture screen views](#capture-screen-views).
- **$autocapture.** The user touches the screen.
- **$exception.** The app throws an exception.

Application lifecycle events are enabled by default. Screen capture is enabled by default in `PostHogProvider` unless you set `captureScreens: false`. Touch capture is disabled by default and requires `captureTouches: true`.

When touch capture is enabled, PostHog tracks touch events for children of `PostHogProvider` and captures a snapshot of the view hierarchy at that point. You can then create [insights](https://posthog.com/docs/product-analytics/insights) in PostHog without adding custom events.

PostHog tries to generate a sensible name for touched elements based on the React component `displayName` or `name`. You can set your own name with the `ph-label` prop:

```jsx
<View ph-label="my-special-label"></View>
```

Configure autocapture with the `autocapture` prop:

```jsx
<PostHogProvider
  apiKey="<ph_project_token>"
  autocapture={{
    captureTouches: true, // Disabled by default
    captureScreens: true, // Enabled by default
    ignoreLabels: [], // Any labels here will be ignored from the stack in touch events
    customLabelProp: 'ph-label',
    maxElementsCaptured: 20,
    noCaptureProp: 'ph-no-capture',
    propsToCapture: ['testID'], // Limit which props are captured. By default, identifiers and text content are captured.

    navigation: {
      // By default, only the screen name is tracked but it is possible to track the
      // params or modify the name by intercepting the autocapture like so
      routeToName: (name, params) => {
        if (params.id) return `${name}/${params.id}`
        return name
      },
      routeToProperties: (name, params) => {
        if (name === 'SensitiveScreen') return undefined
        return params
      },
    },
  }}
>
  ...
</PostHogProvider>
```

To keep an element out of autocapture, add the `ph-no-capture` property. If this property is found anywhere in the view hierarchy, the entire touch event is ignored:

```jsx
<View ph-no-capture>Sensitive view here</View>
```

## Capture screen views

With `captureScreens: true`, the default in `PostHogProvider`, PostHog captures a `$screen` event when the user navigates. This works with `@react-navigation/native` 6.x.x or lower and with `react-native-navigation`.

> **React Navigation 7.x.x.** React Navigation 7.x.x restricts navigation hooks such as `useNavigationState` to components rendered inside a Screen that belongs to a Navigator. Automatic screen tracking may throw errors if PostHog is initialized outside a screen context. This commonly affects apps upgrading from React Navigation 6.x.x. Set `captureScreens: false` and call `posthog.screen()` inside each screen component.

### With `@react-navigation/native` 6.x.x or lower

When you use [@react-navigation/native](https://reactnavigation.org/docs/6.x/getting-started) 6.x.x or lower, PostHog captures screens automatically if you set the `autocapture` property on `PostHogProvider`.

Configure `PostHogProvider` as a child of the `NavigationContainer`:

```jsx
// App.(js|ts)

import { PostHogProvider } from 'posthog-react-native'
import { NavigationContainer } from '@react-navigation/native'

export function App() {
  return (
    <NavigationContainer>
      <PostHogProvider apiKey="<ph_project_token>" autocapture>
        {/* Rest of app */}
      </PostHogProvider>
    </NavigationContainer>
  )
}
```

### With `@react-navigation/native` 7.x.x or higher

When you use [@react-navigation/native](https://reactnavigation.org/docs/7.x/getting-started) 7.x.x or higher, capture screens manually:

```jsx
// App.(js|ts)

import { PostHogProvider } from 'posthog-react-native'
import { NavigationContainer } from '@react-navigation/native'

// Using `PostHogProvider` is optional, but needed if you want to capture touch events automatically with the `captureTouches` option.
export function App() {
  return (
    <NavigationContainer>
      <PostHogProvider
        apiKey="<ph_project_token>"
        autocapture={{
          captureScreens: false, // Screen events are handled differently for v7 and higher
          captureTouches: true,
        }}
      >
        {/* Rest of app */}
      </PostHogProvider>
    </NavigationContainer>
  )
}
```

Set up React Navigation's [screen tracking for analytics](https://reactnavigation.org/docs/screen-tracking/). Then call the `screen` method within the `trackScreenView` method.

```jsx
const posthog = usePostHog() // use the usePostHog hook if using the PostHogProvider or your own custom posthog instance
// you can read the params from `getCurrentRoute()`
posthog.screen(currentRouteName, params)
```

### With `react-native-navigation`

First, wrap your screens with a shared `PostHogProvider`:

```jsx
import PostHog, { PostHogProvider } from 'posthog-react-native'
import { Navigation } from 'react-native-navigation';

export const posthog = new PostHog('<ph_project_token>');

export const SharedPostHogProvider = (props: any) => {
  return (
    <PostHogProvider client={posthog} autocapture={{
      captureScreens: false, // Screen events are handled differently for react-native-navigation
      captureTouches: true,
    }}>
      {props.children}
    </PostHogProvider>
  );
};
```

Then wrap every screen with this provider if you want to capture touches or use the `usePostHog()` hook:

```jsx
export const MyScreen = () => {
  return (
    <SharedPostHogProvider>
      <View>...</View>
    </SharedPostHogProvider>
  )
}

Navigation.registerComponent('Screen', () => MyScreen)

Navigation.events().registerAppLaunchedListener(async () => {
  posthog.initReactNativeNavigation({
    navigation: {
      // (Optional) Set the name based on the route. Defaults to the route name.
      routeToName: (name, properties) => name,
      // (Optional) Tracks all passProps as properties. Defaults to undefined
      routeToProperties: (name, properties) => properties,
    },
    captureScreens: true,
  })
})
```

### With `expo-router`

Set up Expo Router's [screen tracking for analytics](https://docs.expo.dev/router/reference/screen-tracking/). Then call the `screen` method within the `useEffect` callback.

```jsx
const posthog = usePostHog() // use the usePostHog hook if using the PostHogProvider or your own custom posthog instance
posthog.screen(pathname, params)
```

### Capture screens manually

If you prefer not to use autocapture, call `posthog.screen()`. It requires a `name`. You can also pass an optional `properties` object.

```javascript
posthog.screen('dashboard', {
  background: 'blue',
  hero: 'superhog',
})
```

### Filter autocaptured screens

To stop specific screens from being autocaptured, filter them in your `before_send` hook. Return `null` for any `$screen` event whose `$screen_name` matches a screen you don't want to track. The SDK drops it before sending.

Because it's a function, you can filter however you like:

- **Ignorelist.** Drop the screens you name.
- **Allowlist.** Invert the check to capture only the screens you name.
- **Custom rule.** Match a name prefix, a regex, or the event's properties.

`before_send` is a client option, so pass it in the provider's `options` prop, or to `new PostHog(...)` if you create the client yourself:

```jsx
const IGNORED_SCREENS = new Set(['Splash', 'Debug'])

<PostHogProvider
    apiKey="<ph_project_token>"
    autocapture={{ captureScreens: true }}
    options={{
        host: '<ph_client_api_host>',
        before_send: (event) => {
            if (event?.event === '$screen') {
                const screenName = event.properties?.['$screen_name']
                return IGNORED_SCREENS.has(screenName) ? null : event
            }
            return event
        },
    }}
>
    {/* app */}
</PostHogProvider>
```

Swap the check for an allowlist (`return TRACKED_SCREENS.has(screenName) ? event : null`) if you'd rather capture only a specific set of screens.

## Filter and redact events

`before_send` accepts a single function or an array of functions that run in order, so you can compose several small hooks.

**Drop a specific event.** Stop an internal or debug event from ever being sent:

```jsx
const posthog = new PostHog('<ph_project_token>', {
  before_send: (event) => {
    if (event?.event === 'debug_only_event') {
      return null // never send this event
    }
    return event
  },
})
```

**Log events instead of sending them.** Use this while you debug what would be captured:

```jsx
const posthog = new PostHog('<ph_project_token>', {
  before_send: (event) => {
    console.log('[PostHog] would send', event?.event, event?.properties)
    return null // drop everything
  },
})
```

**Redact sensitive properties.** Strip a value before it leaves the device:

```jsx
const posthog = new PostHog('<ph_project_token>', {
  before_send: (event) => {
    if (event?.properties?.email) {
      event.properties.email = '***'
    }
    return event
  },
})
```

## Set person properties

Person properties let you capture, manage, and analyze specific data about a user. You can use them to create [filters](https://posthog.com/docs/product-analytics/trends/filters) or [cohorts](https://posthog.com/docs/data/cohorts), which you can then use in [insights](https://posthog.com/docs/product-analytics/insights), [feature flags](https://posthog.com/docs/feature-flags), and more.

To set a user's properties, include the `$set` or `$set_once` property when you capture any event:

```js
posthog.capture('some_event', { $set: { userProperty: 'value' } })
```

`$set_once` works like `$set`, except it only sets the property if the user doesn't already have that property set. See [the difference between `$set` and `$set_once`](https://posthog.com/docs/product-analytics/person-properties#what-is-the-difference-between-set-and-set_once).

```js
posthog.capture('some_event', { $set_once: { userProperty: 'value' } })
```

You can also use `setPersonProperties()` and `unsetPersonProperties()` to manage person properties directly. See [person properties](https://posthog.com/docs/product-analytics/person-properties) for examples.

Super properties that you set with `posthog.register` are different. They're sent with every `capture` call, including `$screen` events and autocaptured touches, but they don't set the user's properties. `posthog.reset()` clears all stored super properties.

To give one user more than one distinct ID, read the [alias docs](https://posthog.com/docs/product-analytics/identify#alias-assigning-multiple-distinct-ids-to-the-same-user) before you call `alias`.

## Capture events offline

The SDK continues to capture events when the device is offline. When `persistence` is set to `file`, the default, the events are stored in a queue in the device's file storage. Even when the app is closed, the events are persisted and are flushed when the app is opened again.

- **Queue size.** `maxQueueSize` in the configuration sets the maximum size of the queue.
- **Full queue.** When the queue is full, the oldest event is deleted first.
- **Flushing.** The queue is flushed only when the device is online.

`flushAt` sets how many events queue before a flush. `flushInterval` sets the time in milliseconds after which queued events are sent, regardless of how many have been gathered:

```javascript
const posthog = new PostHog('<ph_project_token>', {
  flushAt: 20,
  flushInterval: 10000,
})
```

## Use feature flags

PostHog's [feature flags](https://posthog.com/docs/feature-flags) let you safely deploy and roll back new features, and target specific users and groups with them.

There are two ways to implement feature flags in React Native: with hooks, or by loading the flag directly.

### Use hooks

For a boolean feature flag:

```jsx
import { useFeatureFlag } from 'posthog-react-native'

const MyComponent = () => {
  const booleanFlag = useFeatureFlag('key-for-your-boolean-flag')

  if (booleanFlag === undefined) {
    // the response is undefined if the flags are being loaded
    return null
  }

  // Optional use the 'useFeatureFlagWithPayload' hook for fetching the feature flag payload

  return booleanFlag ? <Text>Testing feature 😄</Text> : <Text>Not Testing feature 😢</Text>
}
```

For a multivariate feature flag:

```jsx
import { useFeatureFlag } from 'posthog-react-native'

const MyComponent = () => {
  const multiVariantFeature = useFeatureFlag('key-for-your-multivariate-flag')

  if (multiVariantFeature === undefined) {
    // the response is undefined if the flags are being loaded
    return null
  } else if (multiVariantFeature === 'variant-name') {
    // replace 'variant-name' with the name of your variant
    // Do something
  }

  // Optional use the 'useFeatureFlagWithPayload' hook for fetching the feature flag payload

  return <div />
}
```

### Load the flag directly

```jsx
// Defaults to undefined if not loaded yet or if there was a problem loading
posthog.isFeatureEnabled('key-for-your-boolean-flag')

// Defaults to undefined if not loaded yet or if there was a problem loading
posthog.getFeatureFlag('key-for-your-boolean-flag')

// Multivariant feature flags are returned as a string
posthog.getFeatureFlag('key-for-your-multivariate-flag')

// Optional: fetch the payload (returns 'JsonType' or undefined if not loaded yet or if there was a problem loading)
posthog.getFeatureFlagResult('key-for-your-multivariate-flag')?.payload
```

### Inspect all feature flags

`getAllFeatureFlags()` returns each loaded flag's `key`, `enabled` state, `variant`, and `payload`. It doesn't send a `$feature_flag_called` event, so calling it won't affect your experiment results or flag usage analytics:

```jsx
for (const flag of posthog.getAllFeatureFlags()) {
  console.log(flag.key, flag.enabled, flag.variant, flag.payload)
}
```

### Wait for flags to load

Every time a user opens the app, the SDK sends a request in the background to fetch the feature flags that apply to that user. It stores those flags in storage.

This means that for most screens, the feature flags are available immediately, except for the first time a user visits.

To handle this, use the `onFeatureFlags` callback to wait for the feature flag request to finish:

```jsx
posthog.onFeatureFlags((flags) => {
  // feature flags are guaranteed to be available at this point
  if (posthog.isFeatureEnabled('flag-key')) {
    // do something
  }
})
```

### Refresh cached flags

The SDK caches feature flag values in storage. Cached values persist with no TTL until a successful API call updates them. This enables offline support and reduces latency, but it means inactive users may see stale flag values from their last session.

For example, if a user last opened your app when a flag was `false`, that value remains cached even after you roll the flag out to 100%. When they reopen the app, the SDK returns the cached `false` first, then fetches the fresh `true` value from the API.

To get fresh flag values, force a refresh on app start:

```jsx
// Force refresh on app start
await posthog.reloadFeatureFlagsAsync()
```

Or clear cached values for inactive users:

```jsx
if (lastActiveDate < migrationDate) {
  posthog.reset() // Clears all cached data
}
```

### Set a request timeout

Set `featureFlagsRequestTimeoutMs` when you initialize the client to set a flag request timeout. This helps prevent your code from being blocked when PostHog's servers are too slow to respond. The default is 10 seconds.

```jsx
export const posthog = new PostHog('<ph_project_token>', {
  // usually 'https://us.i.posthog.com' or 'https://eu.i.posthog.com'
  host: '<ph_client_api_host>',
  featureFlagsRequestTimeoutMs: 10000, // Time in milliseconds. Default is 10000 (10 seconds).
})
```

### Override server properties

Sometimes you want to evaluate feature flags using properties that haven't been ingested yet, or were set incorrectly earlier. Set the properties the flag depends on with these calls:

```jsx
posthog.setPersonPropertiesForFlags({ 'property1': 'value', property2: 'value2' })
```

Setting these properties also reloads feature flags. To skip the reload, pass `false` as the second parameter:

```jsx
posthog.setPersonPropertiesForFlags({ 'property1': 'value', property2: 'value2' }, false)
```

To reset these properties, call `resetPersonPropertiesForFlags`:

```jsx
posthog.resetPersonPropertiesForFlags()
```

The same holds for [group](https://posthog.com/docs/product-analytics/group-analytics) properties:

```jsx
// set properties for a group
posthog.setGroupPropertiesForFlags({ 'company': { 'property1': 'value', property2: 'value2' } })

// reset properties for all groups:
posthog.resetGroupPropertiesForFlags()
```

> **Note.** You don't need to add the group names here, since these properties are automatically attached to the current group, set with `posthog.group()`. When you change the group, these properties are reset.

**Automatic overrides.** Whenever you call `posthog.identify` with person properties, the SDK adds these properties to flag evaluation calls to help determine the correct flag values. The same is true when you call `posthog.group()`.

**Default overridden properties.** PostHog always overrides some properties based on the user's IP address, so geolocation-based flags work without you setting these properties:

1. `$geoip_city_name`
2. `$geoip_country_name`
3. `$geoip_country_code`
4. `$geoip_continent_name`
5. `$geoip_continent_code`
6. `$geoip_postal_code`
7. `$geoip_time_zone`

### Run experiments

[Experiments](https://posthog.com/docs/experiments/start-here) use feature flags, so the code for running an experiment is very similar to the feature flags code. See [adding experiment code](https://posthog.com/docs/experiments/adding-experiment-code) for React Native examples.

You can also [run experiments without feature flags](https://posthog.com/docs/experiments/running-experiments-without-feature-flags).

## Bootstrap feature flags

There's a delay between initializing PostHog and fetching feature flags, so feature flags aren't always available immediately. This makes them unusable if you want to do something like redirect a user to a different page based on a feature flag.

To have your feature flags available immediately, initialize PostHog with precomputed values until it has had a chance to fetch them. This is called bootstrapping. After the SDK fetches feature flags from PostHog, it uses those flag values instead of the bootstrapped ones.

Pass `bootstrap` in the initialization options to seed identity and flag values:

```jsx
<PostHogProvider
  apiKey="<ph_project_token>"
  options={{
    host: '<ph_client_api_host>',
    bootstrap: {
      distinctId: 'distinct_id_of_your_user',
      isIdentifiedId: true,
      featureFlags: {
        'flag-1': true,
        'variant-flag': 'control',
      },
    },
  }}
>
  <MyComponent />
</PostHogProvider>
```

See [bootstrapping feature flags](https://posthog.com/docs/feature-flags/bootstrapping) for server-side evaluation and flag lifecycle, and [SDK bootstrapping](https://posthog.com/docs/libraries/bootstrapping) for cross-SDK identity behavior.

## Supply your own flags

If you evaluate feature flags outside the SDK, you can have the SDK use those values and never fetch flags itself. For example, you can evaluate them on your own server with [`posthog-node` local evaluation](https://posthog.com/docs/feature-flags/local-evaluation), then pass the results into your app.

Set `disableRemoteFeatureFlags: true` so the SDK never requests `/flags`, including the refetches that `identify()`, `group()`, and `reset()` normally trigger. Then push your evaluated flags at runtime with `updateFlags(flags, payloads?, { merge })`:

```jsx
const posthog = new PostHog('<ph_project_token>', {
  host: '<ph_client_api_host>',
  // Don't fetch or evaluate flags on-device – we supply them ourselves.
  disableRemoteFeatureFlags: true,
  // Optional: values that must be available at startup, before updateFlags() runs.
  // Without this, reads return their not-loaded defaults until you push flags.
  bootstrap: {
    featureFlags: { 'my-flag': true },
    featureFlagPayloads: { 'my-flag': { color: 'blue' } },
  },
})

// Later – e.g. after login, once your backend has evaluated flags for this user:
posthog.updateFlags({ 'my-flag': true, 'my-variant-flag': 'test' }, { 'my-flag': { color: 'blue' } })

posthog.getFeatureFlag('my-variant-flag') // 'test'
posthog.getFeatureFlagResult('my-flag')?.payload // { color: 'blue' }
```

`updateFlags` replaces the stored flags by default. Pass `{ merge: true }` to merge into the existing set instead. Values persist across app restarts, and `getFeatureFlag()` and `getFeatureFlagResult()` read them back like any other flag.

`reset()`, which you call on logout, clears the supplied flags. Push them again with `updateFlags()` after the next identity change. Use `bootstrap` for any flag values that must be available at startup before `updateFlags()` runs.

## Track errors

To set up error tracking in your project, see the [error tracking docs](https://posthog.com/docs/error-tracking).

### Capture native crashes

JavaScript autocapture only covers exceptions thrown in your JS/TS code. To capture crashes in native code, such as a native module, the React Native runtime, or a C/C++ library, install the optional `@posthog/react-native-plugin` package and enable one or both of these options. What each option covers depends on the platform:

| Option              | iOS                | Android                  |
| ------------------- | ------------------ | ------------------------ |
| `nativeCrashes`     | Every native crash | Java/Kotlin crashes only |
| `androidNdkCrashes` | Ignored            | C/C++ (NDK) crashes      |

On iOS, `nativeCrashes` covers uncaught Objective-C exceptions, Mach exceptions, and signals such as `SIGSEGV` and `SIGABRT`, including crashes in C/C++ code.

`androidNdkCrashes` needs Android 12 (API 31) or later. It requires `posthog-react-native` 4.78.0 or later and `@posthog/react-native-plugin` 2.12.0 or later.

To capture every native crash on both platforms, enable both:

```jsx
const posthog = new PostHog('<ph_project_token>', {
  host: '<ph_client_api_host>',
  errorTracking: {
    autocapture: {
      nativeCrashes: true,
      androidNdkCrashes: true,
    },
  },
})
```

Native capture is gated by your project's **Enable exception autocapture** setting. Crash reports need native debug symbols uploaded at build time to produce readable stack traces.

An Android NDK crash kills the process immediately, so PostHog captures it on the next app launch from the records the OS kept. Properties such as `$app_version` and the identity describe that launch, not the crash. The first launch after you enable `androidNdkCrashes` also captures NDK crashes the OS still holds from before.

Follow the [React Native installation guide](https://posthog.com/docs/error-tracking/installation/react-native) for the full setup, and [native crash symbolication](https://posthog.com/docs/error-tracking/upload-source-maps/react-native#native-crash-symbolication) to upload symbols.

### Add an error boundary

Use the `PostHogErrorBoundary` component to capture React rendering errors thrown by components:

```jsx
import { PostHogProvider, PostHogErrorBoundary } from 'posthog-react-native'
import { View, Text } from 'react-native'

const App = () => {
  return (
    <PostHogProvider apiKey="<ph_project_token>">
      <PostHogErrorBoundary fallback={YourFallbackComponent} additionalProperties={{ screen: 'home' }}>
        <YourApp />
      </PostHogErrorBoundary>
    </PostHogProvider>
  )
}

const YourFallbackComponent = ({ error, componentStack }) => {
  return (
    <View>
      <Text>Something went wrong!</Text>
      <Text>{error instanceof Error ? error.message : String(error)}</Text>
    </View>
  )
}
```

The `fallback` prop accepts a component to render when an error occurs. The `additionalProperties` prop lets you add custom properties to the captured error event.

> **Caution: duplicate errors with console capture.** If you have both `PostHogErrorBoundary` and `console` capture enabled in your `errorTracking` config, render errors are captured twice. This is because React logs all errors to the console by default. To avoid this, set `console: []` on `errorTracking.autocapture` (for example, `errorTracking: { autocapture: { console: [] } }`) when you use `PostHogErrorBoundary`.

### Customize exception capture

Use the `before_send` callback to modify, filter, or suppress exception events before they're sent to PostHog. This is useful for:

- Adding custom properties to exceptions
- Overriding exception fingerprints for custom grouping
- Suppressing specific types of exceptions
- Redacting sensitive information

```jsx
const posthog = new PostHog('<ph_project_token>', {
  host: '<ph_client_api_host>',
  before_send: (event) => {
    if (event.event === '$exception') {
      const exceptionList = event.properties?.['$exception_list'] || []
      const exception = exceptionList.length > 0 ? exceptionList[0] : null

      if (exception) {
        // Add custom properties
        event.properties['custom_property'] = 'custom_value'

        // Override fingerprint for custom grouping
        event.properties['$exception_fingerprint'] = 'MyCustomGroup'
      }

      // Suppress specific exception types
      if (exception?.['$exception_type'] === 'IgnoredError') {
        return null // Drop the event
      }
    }
    return event
  },
})
```

## Set up other products

- **Group analytics.** Associate the events for a person's session with a group, such as a team or an organization. See [group analytics](https://posthog.com/docs/product-analytics/group-analytics) for implementation details. Group analytics is a paid feature.
- **Logs.** Follow the [React Native logs installation guide](https://posthog.com/docs/logs/installation/react-native). The SDK exposes `posthog.captureLog`, `posthog.logger.{trace,debug,info,warn,error,fatal}`, and `posthog.flushLogs` to send structured records to [PostHog Logs](https://posthog.com/docs/logs). Logs need `posthog-react-native` 4.44.0 or later.
- **Session replay.** Install the SDK and the session replay plugin, then follow the [instructions to enable session replay](https://posthog.com/docs/session-replay/installation/react-native) for React Native. See [mobile session replay](https://posthog.com/docs/session-replay/mobile).
- **Surveys.** Follow the [surveys installation instructions for React Native](https://posthog.com/docs/surveys/installation/react-native). Surveys launched with [popover presentation](https://posthog.com/docs/surveys/creating-surveys#presentation) are shown automatically to users who match the [display conditions](https://posthog.com/docs/surveys/creating-surveys#display-conditions) you set up. URL and CSS selector targeting aren't supported in React Native, so surveys that rely on these conditions won't appear.
- **Push notifications.** The SDK can register a device for [Workflows](https://posthog.com/docs/workflows) push notifications and capture when a user opens one. For setup, including automatic and manual registration, capturing opens, opting out, and identity verification, see [push notifications](https://posthog.com/docs/workflows/push-notifications). For `pushIdentityProvider`, see [identity verification](https://posthog.com/docs/workflows/push-notifications/react-native#identity-verification).
- **Tracing headers.** Use `addTracingHeaders` to connect React Native network requests to backend events, errors, and LLM traces captured by a server-side PostHog SDK.

## Disable in development

You may want to disable PostHog when you work locally or in a test environment. Set the `disabled` option to `true` when you initialize PostHog. You can keep using `usePostHog` and call it safely without anything happening.

```jsx
// App.(js|ts)
import { usePostHog, PostHogProvider } from 'posthog-react-native'
...

export function MyApp() {
    return (
        <PostHogProvider apiKey="<ph_project_token>" options={{
            // Disable PostHog in development (or whatever other logic you choose)
            disabled: __DEV__,
        }}>
            <MyComponent />
        </PostHogProvider>
    )
}

const MyComponent = () => {
    const posthog = usePostHog()

    useEffect(() => {
        // Safe to call even when disabled!
        posthog.capture("mycomponent_loaded", { foo: "bar" })
    }, [])
}
```

To keep capturing your team's events but tell them apart from your users, see [filter internal users](https://posthog.com/tutorials/filter-internal-users).

If you don't see the events, feature flags, or surveys you expect, turn on debug mode with the `debug` prop on `PostHogProvider` or with `posthog.debug()`. It logs the inner workings of the SDK.

## Upgrade from older versions

1.x.x of this library used the underlying `posthog-ios` and `posthog-android` SDKs to do most of the work. Later versions are written entirely in JS and use only Expo supported libraries, so the way you configure and call PostHog changed.

- **iOS.** The SDK attempts to migrate the previously persisted data, such as `distinctId` and `anonymousId`, which should result in no unexpected changes to tracked data.
- **Android.** The SDK can't load persisted Android data. Stored information such as the randomly generated `anonymousId` or the `distinctId` set by `posthog.identify` won't be present. For identified users, call `identify` at least once when the app loads. Anonymous users have no workaround and show up as new anonymous users in PostHog.
- **Install events.** Events such as `Application Installed` and `Application Updated` that require previously persisted data can't be migrated, so you may see much higher numbers for `Application Installed` events. There's no native way to detect a real install, so the SDK stores a marker the first time it loads and treats that as an install.

```jsx
// DEPRECATED V1 Setup

import PostHog from 'posthog-react-native'

await PostHog.setup('<ph_project_token>', {
    // usually 'https://us.i.posthog.com' or 'https://eu.i.posthog.com'
    host: '<ph_client_api_host>',
    captureApplicationLifecycleEvents: false, // Replaced by 'PostHogProvider'
    captureDeepLinks: false, // No longer supported
    recordScreenViews: false, // Replaced by 'PostHogProvider' supporting @react-navigation/native
    flushInterval: 30, // Stays the same
    flushAt: 20, // Stays the same
    android: {...}, // No longer needed
    iOS: {...}, // No longer needed
})

PostHog.capture("foo")


// V2 Setup difference
import PostHog from 'posthog-react-native'

const posthog = await Posthog.initAsync('<ph_project_token>', {
    // usually 'https://us.i.posthog.com' or 'https://eu.i.posthog.com'
    host: '<ph_client_api_host>',
    // Add any other options here.
})

// Use created instance rather than the PostHog class
posthog.capture("foo")

// V3 Setup difference
import PostHog from 'posthog-react-native'

const posthog = new PostHog('<ph_project_token>', {
    // usually 'https://us.i.posthog.com' or 'https://eu.i.posthog.com'
    host: '<ph_client_api_host>',
    // Add any other options here.
})

// Use created instance rather than the PostHog class
posthog.capture("foo")

// V4 Setup difference
import PostHog from 'posthog-react-native'

const posthog = new PostHog('<ph_project_token>', {
    // usually 'https://us.i.posthog.com' or 'https://eu.i.posthog.com'
    host: '<ph_client_api_host>',
    // captureAppLifecycleEvents is enabled by default since version 4.39.0 (previously named `captureNativeAppLifecycleEvents` or `autocapture={{ captureLifecycleEvents: true }}`)
    // captureMode: 'json', // No longer supported
    // maskPhotoLibraryImages: true, // No longer supported
})

posthog.setPersonPropertiesForFlags(...) // instead of `personProperties`
posthog.setGroupPropertiesForFlags(...) // instead of `groupProperties`
```

export type PostHogAutocaptureNavigationTrackerOptions = {
  routeToName?: (name: string, params: any) => string
  routeToProperties?: (name: string, params: any) => Record<string, any>
}

export type PostHogNavigationRef = {
  getCurrentRoute(): any | undefined
  isReady: () => boolean
  current?: PostHogNavigationRef | any | undefined
}

export type PostHogAutocaptureOptions = {
  // Touches
  captureTouches?: boolean
  customLabelProp?: string
  noCaptureProp?: string
  maxElementsCaptured?: number
  ignoreLabels?: string[]
  propsToCapture?: string[]

  /**
   * Capture the screen name (or route name) and properties
   *
   * Only used for expo-router, @react-navigation/native and react-native-navigation
   *
   * For react-native-navigation, you need to call initReactNativeNavigation before using this option
   *  See example: https://posthog.com/docs/libraries/react-native#with-react-native-navigation-and-autocapture
   *
   * For @react-navigation/native v6 and below, you need to wrap the PostHogProvider within the NavigationContainer
   *  See example: https://posthog.com/docs/libraries/react-native#with-react-navigationnative-and-autocapture
   *
   * For @react-navigation/native v7 and above, because of a library change, you'll need to capture the screens manually and disable this option
   *  You can use the onStateChange callback from the NavigationContainer to capture the screens automatically using the screen capture method
   *  You can use the 'usePostHog()' hook or your own posthog instance to capture the screens
   *  Since captureScreens is disabled, you don't need to pass the navigationRef, the navigation mutation object is also ignored
   *  See example: https://reactnavigation.org/docs/screen-tracking/ and https://posthog.com/docs/libraries/react-native#manually-capturing-screen-capture-events
   *
   * For expo-router, expo-router uses @react-navigation/native, but does not expose the NavigationContainer, you'll need to capture the screens manually and disable this option
   *  expo-router always has access to a URL, you can use the URL to capture the screens automatically using the screen capture method
   *  You can use the 'usePostHog()' hook or your own posthog instance to capture the screens
   *  Since captureScreens is disabled, you don't need to pass the navigationRef, the navigation mutation object is also ignored
   *  See example: https://docs.expo.dev/router/reference/screen-tracking/ and https://posthog.com/docs/libraries/react-native#manually-capturing-screen-capture-events
   *
   * @default true
   */
  captureScreens?: boolean
  /**
   * Used for mutating the screen name and properties
   * Only used if captureScreens is true
   *
   * @default Default to the route name and params
   */
  navigation?: PostHogAutocaptureNavigationTrackerOptions
  /**
   * If you create a navigation ref with createNavigationContainerRef, you need to pass the navigation ref
   * Only used for expo-router and @react-navigation/native if captureScreens is true
   */
  navigationRef?: PostHogNavigationRef
}

export interface PostHogCustomAppProperties {
  /** Build number like "1.2.2" or "122" */
  $app_build?: string | null
  /** Name of the app as displayed below the icon like "PostHog" */
  $app_name?: string | null
  /** Namespace of the app usually like "com.posthog.app" */
  $app_namespace?: string | null
  /** Human friendly app version like what a user would see in the app store like "1.2.2" */
  $app_version?: string | null
  /** Manufacturer like "Apple", "Samsung" or "Android" */
  $device_manufacturer?: string | null
  /** Readable model name like "iPhone 12" or "Samsung Galaxy S24" */
  $device_name?: string | null
  /** Model identifier like "iPhone13,2" or "SM-S921B" */
  $device_model?: string | null
  /** Device type ("Mobile" | "Desktop" | "Web") */
  $device_type?: string | null
  /** Operating system name like iOS or Android */
  $os_name?: string | null
  /** Operating system version "14.0" */
  $os_version?: string | null
  /** Locale (language) of the device like "en-US" */
  $locale?: string | null
  /** Timezone of the device like "Europe/Berlin" */
  $timezone?: string | null
}

export type PostHogSessionReplayConfig = {
  /**
   * Enable masking of all text and text input fields
   * Default: true
   */
  maskAllTextInputs?: boolean
  /**
   * Enable masking of all images to a placeholder
   * Default: true
   */
  maskAllImages?: boolean
  /**
   * Enable masking of all sandboxed system views
   * These may include UIImagePickerController, PHPickerViewController and CNContactPickerViewController
   * iOS only
   * Experimental support
   * Default: true
   */
  maskAllSandboxedViews?: boolean
  /**
   * Enable capturing of logcat as console events
   * Android only
   * Default: true
   */
  captureLog?: boolean
  /**
   * Deboucer delay used to reduce the number of snapshots captured and reduce performance impact
   * This is used for capturing the view as a screenshot
   * The lower the number more snapshots will be captured but higher the performance impact
   * Defaults to 1s on iOS
   */
  iOSdebouncerDelayMs?: number
  /**
   * Deboucer delay used to reduce the number of snapshots captured and reduce performance impact
   * This is used for capturing the view as a screenshot
   * The lower the number more snapshots will be captured but higher the performance impact
   * Defaults to 1000ms (1s)
   * Ps: it was 500ms (0.5s) by default until version 3.3.7
   */
  androidDebouncerDelayMs?: number
  /**
   * Enable capturing network telemetry
   * iOS only
   * Default: true
   */
  captureNetworkTelemetry?: boolean
}

export interface PostHogCustomStorage {
  getItem: (key: string) => string | null | Promise<string | null>
  setItem: (key: string, value: string) => void | Promise<void>
}

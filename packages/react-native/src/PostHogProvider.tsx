import React, { type JSX, useCallback, useEffect, useMemo } from 'react'
import { GestureResponderEvent, StyleProp, View, ViewStyle } from 'react-native'
import { PostHog, PostHogOptions } from './posthog-rn'
import { autocaptureFromTouchEvent } from './autocapture'
import { useNavigationTracker } from './hooks/useNavigationTracker'
import { PostHogContext } from './PostHogContext'
import { PostHogAutocaptureOptions } from './types'
import { defaultPostHogLabelProp } from './autocapture'

/**
 * Props for the PostHogProvider component.
 *
 * @public
 */
export interface PostHogProviderProps {
  /** The child components to render within the PostHog context */
  children: React.ReactNode
  /** PostHog configuration options */
  options?: PostHogOptions
  /** Your PostHog API key */
  apiKey?: string
  /** An existing PostHog client instance */
  client?: PostHog
  /** Autocapture configuration - can be a boolean or detailed options */
  autocapture?: boolean | PostHogAutocaptureOptions
  /** Enable debug mode for additional logging */
  debug?: boolean
  /** Custom styles for the provider wrapper View */
  style?: StyleProp<ViewStyle>
}

function PostHogNavigationHook({
  options,
  client,
}: {
  options?: PostHogAutocaptureOptions
  client?: PostHog
}): JSX.Element | null {
  useNavigationTracker(options?.navigation, options?.navigationRef, client)
  return null
}

/**
 * PostHogProvider is a React component that provides PostHog functionality to your React Native app. You can find all configuration options in the [React Native SDK docs](https://posthog.com/docs/libraries/react-native#configuration-options).
 *
 * Autocapturing navigation requires further configuration. See the [React Native SDK navigation docs](https://posthog.com/docs/libraries/react-native#capturing-screen-views)
 * for more information about autocapturing navigation.
 *
 * This is the recommended way to set up PostHog for React Native. This utilizes the Context API to pass the PostHog client around, enable autocapture.
 *
 * {@label Initialization}
 *
 * @example
 * ```jsx
 * // Add to App.(js|ts)
 * import { usePostHog, PostHogProvider } from 'posthog-react-native'
 *
 * export function MyApp() {
 *     return (
 *         <PostHogProvider apiKey="<ph_project_api_key>" options={{
 *             host: '<ph_client_api_host>',
 *         }}>
 *             <MyComponent />
 *         </PostHogProvider>
 *     )
 * }
 *
 * // And access the PostHog client via the usePostHog hook
 * import { usePostHog } from 'posthog-react-native'
 *
 * const MyComponent = () => {
 *     const posthog = usePostHog()
 *
 *     useEffect(() => {
 *         posthog.capture("event_name")
 *     }, [posthog])
 * }
 *
 * ```
 *
 * @example
 * ```jsx
 * // Using with existing client
 * import { PostHog } from 'posthog-react-native'
 *
 * const posthog = new PostHog('<ph_project_api_key>', {
 *     host: '<ph_client_api_host>'
 * })
 *
 * export function MyApp() {
 *     return (
 *         <PostHogProvider client={posthog}>
 *             <MyComponent />
 *         </PostHogProvider>
 *     )
 * }
 * ```
 *
 * @public
 *
 * @param props - The PostHogProvider props
 */
export const PostHogProvider = ({
  children,
  client,
  options,
  apiKey,
  autocapture,
  style,
  debug = false,
}: PostHogProviderProps): JSX.Element | null => {
  if (!client && !apiKey) {
    throw new Error(
      'Either a PostHog client or an apiKey is required. If you want to use the PostHogProvider without a client, please provide an apiKey and the options={ disabled: true }.'
    )
  }

  const captureAll = autocapture === true
  const captureNone = autocapture === false

  const posthog = useMemo(() => {
    if (client && apiKey) {
      console.warn(
        'You have provided both a client and an apiKey to PostHogProvider. The apiKey will be ignored in favour of the client.'
      )
    }

    if (client) {
      return client
    }

    const parsedOptions = {
      ...options,
      captureAppLifecycleEvents:
        options?.captureAppLifecycleEvents !== undefined
          ? options.captureAppLifecycleEvents
          : !captureNone && captureAll,
    }

    return new PostHog(apiKey ?? '', parsedOptions)
  }, [client, apiKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const autocaptureOptions = useMemo(
    () => (autocapture && typeof autocapture !== 'boolean' ? autocapture : {}),
    [autocapture]
  )

  const captureTouches = !captureNone && posthog && (captureAll || autocaptureOptions?.captureTouches)
  const captureScreens = !captureNone && posthog && (captureAll || (autocaptureOptions?.captureScreens ?? true)) // Default to true if not set
  const phLabelProp = autocaptureOptions?.customLabelProp || defaultPostHogLabelProp

  useEffect(() => {
    posthog.debug(debug)
  }, [debug, posthog])

  const onTouch = useCallback(
    (type: 'start' | 'move' | 'end', e: GestureResponderEvent) => {
      // TODO: Improve this to ensure we only capture presses and not just ends of a drag for example
      if (!captureTouches) {
        return
      }

      if (type === 'end') {
        autocaptureFromTouchEvent(e, posthog, autocaptureOptions)
      }
    },
    [captureTouches, posthog, autocaptureOptions]
  )

  return (
    <View
      {...{ [phLabelProp]: 'PostHogProvider' }} // Dynamically setting customLabelProp (default: ph-label)
      style={style || { flex: 1 }}
      onTouchEndCapture={captureTouches ? (e) => onTouch('end', e) : undefined}
    >
      <PostHogContext.Provider value={{ client: posthog }}>
        {captureScreens && <PostHogNavigationHook options={autocaptureOptions} client={posthog} />}
        {children}
      </PostHogContext.Provider>
    </View>
  )
}

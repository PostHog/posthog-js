import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { GestureResponderEvent, StyleProp, View, ViewStyle } from 'react-native'
import { PostHog, PostHogOptions } from './posthog-rn'
import { autocaptureFromTouchEvent } from './autocapture'
import { useNavigationTracker } from './hooks/useNavigationTracker'
import { PostHogContext } from './PostHogContext'
import { PostHogAutocaptureOptions } from './types'
import { isWeb } from './utils'
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
  /**
   * Autocapture configuration - can be a boolean or detailed options.
   *
   * When not set, the default behavior is:
   * - `captureScreens`: true
   * - `captureTouches`: false
   * - `captureAppLifecycleEvents`: true
   *
   * Set to `true` to enable all autocapture features (including touches).
   * Set to `false` to disable all autocapture features.
   */
  autocapture?: boolean | PostHogAutocaptureOptions
  /**
   * Enable debug mode for additional logging
   *
   * @default false
   */
  debug?: boolean
  /** Custom styles for the provider wrapper View */
  style?: StyleProp<ViewStyle>
}

// One document click listener per client, shared across sibling providers, so one interaction
// enqueues exactly one $autocapture event (sdk-specs autocapture). `owners` holds every mounted
// provider's host node: it scopes the shared listener, and its size doubles as the refcount.
const webClickListeners = new WeakMap<PostHog, { owners: Set<unknown>; remove: () => void }>()

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
        options?.captureAppLifecycleEvents !== undefined ? options.captureAppLifecycleEvents : !captureNone,
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

  // Browsers fire touchend only for touch input, so a mouse never reaches onTouchEndCapture.
  // Listen on the document in the CAPTURE phase: RNW forwards `onClick` but not `onClickCapture`,
  // and its Pressable stops propagation before any bubble-phase handler runs. Document-wide so it
  // still sees Modal; subtree scoping happens in autocapture.tsx. Read options through a ref so an
  // inline `autocapture` prop doesn't re-attach every render.
  const hostRef = useRef<unknown>(null)
  const optionsRef = useRef(autocaptureOptions)
  useEffect(() => {
    optionsRef.current = autocaptureOptions
  }, [autocaptureOptions])

  useEffect(() => {
    // The package targets ESNext without the DOM lib, so reach the document off the global.
    const doc = (globalThis as any)?.document
    if (!isWeb() || !captureTouches || !doc?.addEventListener) {
      return
    }

    const ownerNode = hostRef.current
    const existing = webClickListeners.get(posthog)
    if (existing) {
      existing.owners.add(ownerNode)
    } else {
      // Options come from whichever provider installed the listener; sibling providers on one
      // client are expected to be configured alike.
      const optionsForClient = optionsRef
      const owners = new Set<unknown>([ownerNode])
      const handler = (e: any): void => {
        autocaptureFromTouchEvent(
          { target: e.target, nativeEvent: e },
          posthog,
          optionsForClient.current,
          'click',
          owners
        )
      }
      doc.addEventListener('click', handler, true)
      webClickListeners.set(posthog, {
        owners,
        remove: () => doc.removeEventListener('click', handler, true),
      })
    }

    return () => {
      const entry = webClickListeners.get(posthog)
      if (!entry) {
        return
      }
      entry.owners.delete(ownerNode)
      if (entry.owners.size === 0) {
        entry.remove()
        webClickListeners.delete(posthog)
      }
    }
  }, [captureTouches, posthog])

  const captureProps = isWeb()
    ? {}
    : { onTouchEndCapture: captureTouches ? (e: GestureResponderEvent) => onTouch('end', e) : undefined }

  return (
    <View
      ref={hostRef as any}
      {...{ [phLabelProp]: 'PostHogProvider' }} // Dynamically setting customLabelProp (default: ph-label)
      style={style || { flex: 1 }}
      {...captureProps}
    >
      <PostHogContext.Provider value={{ client: posthog }}>
        {captureScreens && <PostHogNavigationHook options={autocaptureOptions} client={posthog} />}
        {children}
      </PostHogContext.Provider>
    </View>
  )
}

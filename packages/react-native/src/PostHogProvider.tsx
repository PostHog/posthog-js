import React, { useCallback, useEffect, useMemo } from 'react'
import { GestureResponderEvent, StyleProp, View, ViewStyle } from 'react-native'
import { PostHog, PostHogOptions } from './posthog-rn'
import { autocaptureFromTouchEvent } from './autocapture'
import { useNavigationTracker } from './hooks/useNavigationTracker'
import { PostHogContext } from './PostHogContext'
import { PostHogAutocaptureOptions } from './types'
import { defaultPostHogLabelProp } from './autocapture'

export interface PostHogProviderProps {
  children: React.ReactNode
  options?: PostHogOptions
  apiKey?: string
  client?: PostHog
  autocapture?: boolean | PostHogAutocaptureOptions
  debug?: boolean
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

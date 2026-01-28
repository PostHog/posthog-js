import React from 'react'
import { View, ViewProps } from 'react-native'

/**
 * Props for the PostHogMaskView component.
 *
 * @public
 */
export interface PostHogMaskViewProps extends ViewProps {
  /** The child components to mask from PostHog capture */
  children: React.ReactNode
}

/**
 * PostHogMaskView is a wrapper component that hides its children from PostHog
 * session recordings without compromising accessibility.
 *
 * It works by:
 * - Setting `accessibilityLabel` to `"ph-no-capture"` to hide the content from session recordings
 * - Setting `importantForAccessibility` to `"no"` to prevent the wrapper View from hiding
 *   accessible content on Android (since `accessibilityLabel` would otherwise interfere)
 *
 * @example
 * ```jsx
 * import { PostHogMaskView } from 'posthog-react-native'
 *
 * function SensitiveForm() {
 *   return (
 *     <PostHogMaskView>
 *       <TextInput placeholder="Credit card number" />
 *       <TextInput placeholder="CVV" />
 *     </PostHogMaskView>
 *   )
 * }
 * ```
 *
 * @public
 */
export const PostHogMaskView = ({ children, ...viewProps }: PostHogMaskViewProps): JSX.Element => (
  <View {...viewProps} accessibilityLabel="ph-no-capture" importantForAccessibility="no">
    {children}
  </View>
)

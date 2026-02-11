import React, { FunctionComponent } from 'react'
import { PostHogContext } from './PostHogContext'

export type Properties = Record<string, any>

export type PostHogErrorBoundaryFallbackProps = {
  error: unknown
  componentStack: string
}

export type PostHogErrorBoundaryProps = {
  children?: React.ReactNode | (() => React.ReactNode)
  fallback?: React.ReactNode | FunctionComponent<PostHogErrorBoundaryFallbackProps>
  additionalProperties?: Properties | ((error: unknown) => Properties)
}

type PostHogErrorBoundaryState = {
  componentStack: string | null
  error: unknown
}

const INITIAL_STATE: PostHogErrorBoundaryState = {
  componentStack: null,
  error: null,
}

const isFunction = (f: any): f is (...args: any[]) => any => typeof f === 'function'

export const __POSTHOG_ERROR_MESSAGES = {
  INVALID_FALLBACK:
    '[PostHog][PostHogErrorBoundary] Invalid fallback prop, provide a valid React element or a function that returns a valid React element.',
}

/**
 * PostHogErrorBoundary is a React Error Boundary component that automatically
 * captures exceptions with PostHog when they occur in its child component tree.
 *
 * @example
 * ```jsx
 * import { PostHogErrorBoundary } from 'posthog-react-native'
 *
 * function App() {
 *   return (
 *     <PostHogProvider apiKey="<ph_project_api_key>">
 *       <PostHogErrorBoundary fallback={<Text>Something went wrong</Text>}>
 *         <MyComponent />
 *       </PostHogErrorBoundary>
 *     </PostHogProvider>
 *   )
 * }
 * ```
 *
 * @example
 * ```jsx
 * // With a fallback component that receives error details
 * <PostHogErrorBoundary
 *   fallback={({ error, componentStack }) => (
 *     <View>
 *       <Text>Error: {error.message}</Text>
 *     </View>
 *   )}
 *   additionalProperties={{ screen: 'home' }}
 * >
 *   <MyComponent />
 * </PostHogErrorBoundary>
 * ```
 *
 * @public
 */
export class PostHogErrorBoundary extends React.Component<PostHogErrorBoundaryProps, PostHogErrorBoundaryState> {
  static contextType = PostHogContext
  context!: React.ContextType<typeof PostHogContext>

  constructor(props: PostHogErrorBoundaryProps) {
    super(props)
    this.state = INITIAL_STATE
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo): void {
    const { additionalProperties } = this.props
    let currentProperties
    if (isFunction(additionalProperties)) {
      currentProperties = additionalProperties(error)
    } else if (typeof additionalProperties === 'object') {
      currentProperties = additionalProperties
    }
    const { client } = this.context
    client.captureException(error, currentProperties)

    const { componentStack } = errorInfo
    this.setState({
      error,
      componentStack: componentStack ?? null,
    })
  }

  public render(): React.ReactNode {
    const { children, fallback } = this.props
    const state = this.state

    if (state.componentStack == null) {
      return isFunction(children) ? children() : children
    }

    const element = isFunction(fallback)
      ? (React.createElement(fallback, {
            error: state.error,
            componentStack: state.componentStack,
        }) as React.ReactNode)
      : fallback

    if (React.isValidElement(element)) {
      return element as React.ReactElement
    }
    //eslint-disable-next-line no-console
    console.warn(__POSTHOG_ERROR_MESSAGES.INVALID_FALLBACK)
    return <></>
  }
}

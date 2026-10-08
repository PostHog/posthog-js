import React, { FunctionComponent } from 'react'
import { PostHogContext } from './PostHogContext'

export type Properties = Record<string, any>

export type PostHogErrorBoundaryFallbackProps = {
  error: unknown
  componentStack: string
  resetError: () => void
}

export type PostHogErrorBoundaryProps = {
  children?: React.ReactNode | (() => React.ReactNode)
  fallback?: React.ReactNode | FunctionComponent<PostHogErrorBoundaryFallbackProps>
  additionalProperties?: Properties | ((error: unknown) => Properties)
}

type PostHogErrorBoundaryState = {
  hasError: boolean
  componentStack: string | null
  error: unknown
}

const INITIAL_STATE: PostHogErrorBoundaryState = {
  hasError: false,
  componentStack: null,
  error: null,
}

const isFunction = (f: any): f is (...args: any[]) => any => typeof f === 'function'

export class PostHogErrorBoundary extends React.Component<PostHogErrorBoundaryProps, PostHogErrorBoundaryState> {
  static contextType = PostHogContext
  context!: React.ContextType<typeof PostHogContext>

  constructor(props: PostHogErrorBoundaryProps) {
    super(props)
    this.state = INITIAL_STATE
  }

  static getDerivedStateFromError(error: unknown): Partial<PostHogErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo): void {
    const { componentStack } = errorInfo
    this.setState({ componentStack: componentStack ?? null })

    try {
      const { additionalProperties } = this.props
      const currentProperties = isFunction(additionalProperties) ? additionalProperties(error) : additionalProperties
      this.context.client?.captureException(error, {
        ...currentProperties,
        ...(componentStack ? { $exception_component_stack: componentStack } : {}),
      })
    } catch {
      // Reporting failures must not escape the boundary and crash its parent.
    }
  }

  private resetError = (): void => {
    this.setState(INITIAL_STATE)
  }

  public render(): React.ReactNode {
    const { children, fallback } = this.props
    const state = this.state

    if (!state.hasError) {
      return isFunction(children) ? children() : children
    }

    const element = isFunction(fallback)
      ? (React.createElement(fallback, {
          error: state.error,
          componentStack: state.componentStack ?? '',
          resetError: this.resetError,
        }) as React.ReactNode)
      : fallback

    if (React.isValidElement(element)) {
      return element as React.ReactElement
    }

    return <></>
  }
}

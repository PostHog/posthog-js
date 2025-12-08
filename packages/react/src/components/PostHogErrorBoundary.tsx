import React, { FunctionComponent } from 'react'
import { PostHogContext } from '../context'
import { isFunction } from '../utils/type-utils'

export type Properties = Record<string, any>

export type PostHogErrorBoundaryFallbackProps = {
    error: unknown
    exceptionEvent: unknown
    componentStack: string
}

export type PostHogErrorBoundaryProps = {
    children?: React.ReactNode | (() => React.ReactNode)
    fallback?: React.ReactNode | FunctionComponent<PostHogErrorBoundaryFallbackProps>
    additionalProperties?: Properties | ((error: unknown) => Properties)
}

type PostHogErrorBoundaryState = {
    componentStack: string | null
    exceptionEvent: unknown
    error: unknown
}

const INITIAL_STATE: PostHogErrorBoundaryState = {
    componentStack: null,
    exceptionEvent: null,
    error: null,
}

export const __POSTHOG_ERROR_MESSAGES = {
    INVALID_FALLBACK:
        '[PostHog.js][PostHogErrorBoundary] Invalid fallback prop, provide a valid React element or a function that returns a valid React element.',
}

export class PostHogErrorBoundary extends React.Component<PostHogErrorBoundaryProps, PostHogErrorBoundaryState> {
    static contextType = PostHogContext
    declare context: React.ContextType<typeof PostHogContext>

    constructor(props: PostHogErrorBoundaryProps) {
        super(props)
        this.state = INITIAL_STATE
    }

    componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
        //eslint-disable-next-line react/prop-types
        const { additionalProperties } = this.props
        let currentProperties
        if (isFunction(additionalProperties)) {
            currentProperties = additionalProperties(error)
        } else if (typeof additionalProperties === 'object') {
            currentProperties = additionalProperties
        }
        const { client } = this.context
        const exceptionEvent = client.captureException(error, currentProperties)

        const { componentStack } = errorInfo
        this.setState({
            error,
            componentStack: componentStack ?? null,
            exceptionEvent,
        })
    }

    public render(): React.ReactNode {
        //eslint-disable-next-line react/prop-types
        const { children, fallback } = this.props
        const state = this.state

        if (state.componentStack == null) {
            return isFunction(children) ? children() : children
        }

        const element = isFunction(fallback)
            ? (React.createElement(fallback, {
                  error: state.error,
                  componentStack: state.componentStack,
                  exceptionEvent: state.exceptionEvent,
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

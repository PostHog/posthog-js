import React, { FunctionComponent } from 'react'
import { PostHogContext } from '../context'
import { isFunction } from '../utils/type-utils'

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

export const __POSTHOG_ERROR_MESSAGES = {
    INVALID_FALLBACK:
        '[PostHog.js][PostHogErrorBoundary] Invalid fallback prop, provide a valid React element or a function that returns a valid React element.',
}

export class PostHogErrorBoundary extends React.Component<PostHogErrorBoundaryProps, PostHogErrorBoundaryState> {
    static contextType = PostHogContext

    constructor(props: PostHogErrorBoundaryProps) {
        super(props)
        this.state = INITIAL_STATE
    }

    componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
        const { componentStack } = errorInfo
        //eslint-disable-next-line react/prop-types
        const { additionalProperties } = this.props
        this.setState({
            error,
            componentStack,
        })
        let currentProperties
        if (isFunction(additionalProperties)) {
            currentProperties = additionalProperties(error)
        } else if (typeof additionalProperties === 'object') {
            currentProperties = additionalProperties
        }
        const { client } = this.context
        client.captureException(error, currentProperties)
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

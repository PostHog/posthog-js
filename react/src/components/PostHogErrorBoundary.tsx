/* eslint-disable no-console */

import React from 'react'
import { PostHog, PostHogContext } from '../context'
import { isFunction } from '../utils/type-utils'

export type Properties = Record<string, any>

export type PostHogErrorBoundaryProps = {
    children: React.ReactNode
    fallback: React.ReactNode
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

export const __POSTHOG_ERROR_WARNING_MESSAGES = {
    INVALID_FALLBACK:
        '[PostHog.js] Invalid fallback prop, provide a valid React element or a function that returns a valid React element.',
    NO_POSTHOG_CONTEXT: '[PostHog.js] No PostHog context found, make sure you are using the PostHogProvider component.',
}

export class PostHogErrorBoundary extends React.Component<PostHogErrorBoundaryProps, PostHogErrorBoundaryState> {
    static contextType = PostHogContext

    constructor(props: PostHogErrorBoundaryProps) {
        super(props)
        this.state = INITIAL_STATE
    }

    componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
        const { client } = this.context as { client: PostHog }
        const { additionalProperties } = this.props
        const { componentStack } = errorInfo
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
        client.captureException(error, currentProperties)
    }

    render() {
        const { children, fallback } = this.props
        const { client } = this.context as { client: PostHog }
        const state = this.state

        if (!client) {
            console.warn(__POSTHOG_ERROR_WARNING_MESSAGES.NO_POSTHOG_CONTEXT)
        }

        if (state.componentStack == null) {
            return isFunction(children) ? children() : children
        }

        const element = isFunction(fallback)
            ? React.createElement(fallback, {
                  error: state.error,
                  componentStack: state.componentStack,
              })
            : fallback

        if (React.isValidElement(element)) {
            return element
        }

        console.warn(__POSTHOG_ERROR_WARNING_MESSAGES.INVALID_FALLBACK)

        return null
    }
}

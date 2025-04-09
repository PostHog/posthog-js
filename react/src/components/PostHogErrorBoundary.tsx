/* eslint-disable no-console */

import React from 'react'
import { PostHog, PostHogContext } from '../context'
import { isFunction } from '../utils/type-utils'

export type PostHogErrorBoundaryProps = {
    children: React.ReactNode
    fallback: React.ReactNode
}

type PostHogErrorBoundaryState = {
    componentStack: string | null
    error: unknown
}

const INITIAL_STATE: PostHogErrorBoundaryState = {
    componentStack: null,
    error: null,
}

export class PostHogErrorBoundary extends React.Component<PostHogErrorBoundaryProps, PostHogErrorBoundaryState> {
    static contextType = PostHogContext

    constructor(props: PostHogErrorBoundaryProps) {
        super(props)
        this.state = INITIAL_STATE
    }

    componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
        const { client } = this.context as { client: PostHog }
        const { componentStack } = errorInfo
        this.setState({
            error,
            componentStack,
        })
        client.captureException(error)
    }

    render() {
        const { children, fallback } = this.props
        const { client } = this.context as { client: PostHog }
        const state = this.state

        if (!client) {
            console.error('[PostHog.js] PostHogErrorBoundary must be used within a PostHogProvider')
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

        console.warn(
            '[PostHog.js] Invalid fallback prop, provide a valid React element or a function that returns a valid React element.'
        )

        return null
    }
}

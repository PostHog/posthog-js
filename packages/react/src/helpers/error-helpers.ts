import type { ErrorInfo } from 'react'
import { PostHog } from '../context'
import type { CaptureResult } from 'posthog-js'
import { addReactComponentStack } from './react-component-stack'

export const setupReactErrorHandler = (
    client: PostHog,
    callback?: (event: CaptureResult | undefined, error: any, errorInfo: ErrorInfo) => void
) => {
    return (error: any, errorInfo: ErrorInfo): void => {
        const event = client.captureException(addReactComponentStack(error, errorInfo.componentStack))
        if (callback) {
            callback(event, error, errorInfo)
        }
    }
}

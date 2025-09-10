import type { ErrorInfo } from 'react'
import { PostHog } from '../context'
import { CaptureResult } from 'posthog-js'

export const setupReactErrorHandler = (
    client: PostHog,
    callback?: (event: CaptureResult | undefined, error: any, errorInfo: ErrorInfo) => void
) => {
    return (error: any, errorInfo: ErrorInfo): void => {
        const event = client.captureException(error)
        if (callback) {
            callback(event, error, errorInfo)
        }
    }
}

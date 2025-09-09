import type { ErrorInfo } from 'react'
import { PostHog } from '../context'

export const setupReactErrorHandler = (
    client: PostHog,
    callback?: (event: any, error: any, errorInfo: ErrorInfo) => void
) => {
    return (error: any, errorInfo: ErrorInfo): void => {
        const event = client.captureException(error)
        if (callback) {
            callback(event, error, errorInfo)
        }
    }
}
